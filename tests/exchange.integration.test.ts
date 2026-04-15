import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app";
import { DepositModel } from "../src/modules/deposit/deposit.model";
import { ExchangeModel } from "../src/modules/exchange/exchange.model";
import { PlayerModel } from "../src/modules/player/player.model";
import { UserModel } from "../src/modules/users/user.model";
import { WithdrawalModel } from "../src/modules/withdrawal/withdrawal.model";
import { bootstrapData } from "../src/shared/db/bootstrap";

describe("Exchange API integration", () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let accessToken = "";

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await bootstrapData();

    const loginRes = await request(app).post("/api/v1/auth/login").send({
      username: "superadmin",
      password: "SuperAdmin@123",
    });
    accessToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("creates exchange successfully", async () => {
    const res = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "E2E",
        provider: "Provider A",
        openingBalance: 300,
        bonus: 0,
        status: "active",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("E2E");
  });

  it("rejects duplicate exchange", async () => {
    const res = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "E2E",
        provider: "Provider A",
        openingBalance: 200,
        bonus: 0,
        status: "active",
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("business_rule_error");
  });

  it("lists exchanges with pagination", async () => {
    const res = await request(app)
      .get("/api/v1/exchange?page=1&pageSize=10&search=E2E")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.page).toBe(1);
  });

  it("returns unauthorized without token", async () => {
    const res = await request(app).get("/api/v1/exchange");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("auth_error");
  });

  it("returns validation error for bad payload", async () => {
    const res = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "",
        provider: "p",
        openingBalance: -1,
        bonus: -2,
        status: "active",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("returns exchange statement with opposite perspective and net amounts", async () => {
    const actor = await UserModel.findOne({ username: "superadmin" }).select("_id").lean();
    expect(actor?._id).toBeDefined();
    const actorId = actor!._id;

    const exchange = await ExchangeModel.create({
      name: "E2E Statement",
      provider: "Provider S",
      openingBalance: 1000,
      bonus: 0,
      status: "active",
      createdBy: actorId,
      updatedBy: actorId,
    });

    const playerA = await PlayerModel.create({
      exchange: exchange._id,
      playerId: "PL-A",
      phone: "9000000001",
      regularBonusPercentage: 5,
      firstDepositBonusPercentage: 10,
      createdBy: actorId,
      updatedBy: actorId,
    });

    const playerB = await PlayerModel.create({
      exchange: exchange._id,
      playerId: "PL-B",
      phone: "9000000002",
      regularBonusPercentage: 5,
      firstDepositBonusPercentage: 10,
      createdBy: actorId,
      updatedBy: actorId,
    });

    await DepositModel.create({
      bankName: "Bank A",
      utr: "UTR-BEFORE-001",
      amount: 100,
      totalAmount: 120,
      bonusAmount: 20,
      status: "verified",
      createdBy: actorId,
      player: playerA._id,
      settledAt: new Date("2026-04-09T10:00:00.000Z"),
    });

    await DepositModel.create({
      bankName: "Bank A",
      utr: "UTR-IN-001",
      amount: 200,
      totalAmount: 220,
      bonusAmount: 20,
      status: "verified",
      createdBy: actorId,
      player: playerA._id,
      settledAt: new Date("2026-04-10T10:00:00.000Z"),
    });

    await WithdrawalModel.create({
      player: playerA._id,
      playerName: "PL-A",
      bankName: "Payout Bank",
      amount: 300,
      payableAmount: 250,
      reverseBonus: 50,
      status: "approved",
      createdBy: actorId,
      updatedAt: new Date("2026-04-10T12:00:00.000Z"),
      createdAt: new Date("2026-04-10T12:00:00.000Z"),
    });

    await WithdrawalModel.create({
      player: playerB._id,
      playerName: "PL-B",
      bankName: "Payout Bank",
      amount: 99,
      payableAmount: 99,
      reverseBonus: 0,
      status: "approved",
      createdBy: actorId,
      updatedAt: new Date("2026-04-10T14:00:00.000Z"),
      createdAt: new Date("2026-04-10T14:00:00.000Z"),
    });

    const res = await request(app)
      .get(`/api/v1/exchange/${exchange._id.toString()}/statement?fromDate=2026-04-10&toDate=2026-04-10&playerId=${playerA._id.toString()}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.periodOpeningBalance).toBe(880);
    expect(res.body.data.totalDebits).toBe(220);
    expect(res.body.data.totalCredits).toBe(250);
    expect(res.body.data.periodClosingBalance).toBe(910);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows[0].kind).toBe("deposit");
    expect(res.body.data.rows[0].direction).toBe("debit");
    expect(res.body.data.rows[0].amount).toBe(220);
    expect(res.body.data.rows[1].kind).toBe("withdrawal");
    expect(res.body.data.rows[1].direction).toBe("credit");
    expect(res.body.data.rows[1].amount).toBe(250);
  });
});

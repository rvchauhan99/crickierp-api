import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app";
import { bootstrapData } from "../src/shared/db/bootstrap";
import { ExchangeModel } from "../src/modules/exchange/exchange.model";
import { PlayerModel } from "../src/modules/player/player.model";
import { UserModel } from "../src/modules/users/user.model";
import { DepositModel } from "../src/modules/deposit/deposit.model";
import { WithdrawalModel } from "../src/modules/withdrawal/withdrawal.model";
import { computeAllTimeExchangeBalances } from "../src/shared/services/exchange-balance.service";
import { recomputeExchangeCurrentBalance } from "../src/modules/exchange/exchange.service";

describe("Sub exchange management", () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let accessToken = "";
  let actorId = "";

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await bootstrapData();

    const loginRes = await request(app).post("/api/v1/auth/login").send({
      username: "superadmin",
      password: "SuperAdmin@123",
    });
    accessToken = loginRes.body.data.accessToken;
    const actor = await UserModel.findOne({ username: "superadmin" }).select("_id").lean();
    actorId = String(actor!._id);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("creates a sub exchange under a parent", async () => {
    const parentRes = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Parent EX",
        provider: "Prov Sub",
        openingBalance: 1000,
        bonus: 0,
        status: "active",
      });
    expect(parentRes.status).toBe(201);
    const parentId = String(parentRes.body.data._id);

    const subRes = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Sub A",
        parentExchangeId: parentId,
        openingBalance: 200,
        bonus: 0,
        status: "active",
      });
    expect(subRes.status).toBe(201);
    expect(subRes.body.data.name).toBe("Sub A");
    expect(subRes.body.data.provider).toBe("Prov Sub");
    expect(String(subRes.body.data.parentExchange)).toBe(parentId);
  });

  it("rejects player create on a group parent and accepts on a sub", async () => {
    const parent = await ExchangeModel.findOne({ name: "Parent EX", provider: "Prov Sub" }).lean();
    expect(parent).toBeTruthy();
    const parentId = String(parent!._id);
    const sub = await ExchangeModel.findOne({ name: "Sub A", parentExchange: parent!._id }).lean();
    expect(sub).toBeTruthy();

    const rejectRes = await request(app)
      .post("/api/v1/players")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        exchangeId: parentId,
        playerId: "SUB-PL-1",
        phone: "9800000001",
        regularBonusPercentage: 0,
        firstDepositBonusPercentage: 0,
        referralPercentage: 1,
      });
    expect(rejectRes.status).toBe(400);
    expect(String(rejectRes.body.error?.message || "")).toMatch(/sub exchange/i);

    const okRes = await request(app)
      .post("/api/v1/players")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        exchangeId: String(sub!._id),
        playerId: "SUB-PL-1",
        phone: "9800000001",
        regularBonusPercentage: 0,
        firstDepositBonusPercentage: 0,
        referralPercentage: 1,
      });
    expect(okRes.status).toBe(201);
    const created = await PlayerModel.findById(okRes.body.data._id).lean();
    expect(String(created!.exchange)).toBe(String(sub!._id));
    expect(String(created!.rootExchange)).toBe(parentId);
  });

  it("rejects top-up on a group parent", async () => {
    const parent = await ExchangeModel.findOne({ name: "Parent EX", provider: "Prov Sub" }).lean();
    const res = await request(app)
      .post("/api/v1/exchange-topup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        exchangeId: String(parent!._id),
        amount: 50,
        remark: "should fail",
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error?.message || "")).toMatch(/sub exchange/i);
  });

  it("rolls parent balance as own ledger + sub ledgers", async () => {
    const parent = await ExchangeModel.findOne({ name: "Parent EX", provider: "Prov Sub" }).lean();
    const sub = await ExchangeModel.findOne({ name: "Sub A", parentExchange: parent!._id }).lean();
    const player = await PlayerModel.findOne({ playerId: "SUB-PL-1" }).lean();

    await DepositModel.create({
      player: player!._id,
      amount: 100,
      totalAmount: 100,
      bonusAmount: 0,
      status: "verified",
      bankName: "Test",
      utr: `UTR-SUB-${Date.now()}`,
      createdBy: actorId,
    });
    await WithdrawalModel.create({
      player: player!._id,
      playerName: "SUB-PL-1",
      bankName: "Payout Bank",
      amount: 40,
      payableAmount: 40,
      reverseBonus: 0,
      status: "approved",
      createdBy: actorId,
    });

    await recomputeExchangeCurrentBalance(String(sub!._id));
    const balances = await computeAllTimeExchangeBalances([parent!._id, sub!._id]);
    // sub: 200 - 100 + 40 = 140
    expect(balances.get(String(sub!._id))).toBe(140);
    // parent: own 1000 + sub 140 = 1140
    expect(balances.get(String(parent!._id))).toBe(1140);
  });

  it("moves unassigned players to a sub exchange", async () => {
    const parentRes = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Move Parent",
        provider: "Move Prov",
        openingBalance: 500,
        bonus: 0,
        status: "active",
      });
    const parentId = String(parentRes.body.data._id);

    const directPlayer = await PlayerModel.create({
      exchange: parentId,
      rootExchange: parentId,
      playerId: "MOVE-PL-1",
      phone: "9700000001",
      regularBonusPercentage: 0,
      firstDepositBonusPercentage: 0,
      createdBy: actorId,
      updatedBy: actorId,
    });

    const subRes = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Move Sub",
        parentExchangeId: parentId,
        openingBalance: 0,
        bonus: 0,
        status: "active",
      });
    const subId = String(subRes.body.data._id);

    const moveRes = await request(app)
      .post(`/api/v1/exchange/${parentId}/move-players`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ targetSubExchangeId: subId, all: true });
    expect(moveRes.status).toBe(200);
    expect(moveRes.body.data.moved).toBe(1);

    const refreshed = await PlayerModel.findById(directPlayer._id).lean();
    expect(String(refreshed!.exchange)).toBe(subId);
    expect(String(refreshed!.rootExchange)).toBe(parentId);

    const detail = await request(app)
      .get(`/api/v1/exchange/${parentId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.unassignedPlayerCount).toBe(0);
  });

  it("keeps normal flow for exchanges without subs", async () => {
    const res = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Direct Only",
        provider: "Direct Prov",
        openingBalance: 300,
        bonus: 0,
        status: "active",
      });
    expect(res.status).toBe(201);
    const exchangeId = String(res.body.data._id);

    const playerRes = await request(app)
      .post("/api/v1/players")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        exchangeId,
        playerId: "DIR-PL-1",
        phone: "9600000001",
        regularBonusPercentage: 0,
        firstDepositBonusPercentage: 0,
        referralPercentage: 1,
      });
    expect(playerRes.status).toBe(201);

    const topupRes = await request(app)
      .post("/api/v1/exchange-topup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ exchangeId, amount: 25 });
    expect(topupRes.status).toBe(201);
  });
});

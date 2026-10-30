import request from "supertest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app";
import { bootstrapData } from "../src/shared/db/bootstrap";
import { UserModel } from "../src/modules/users/user.model";
import { BankModel } from "../src/modules/bank/bank.model";
import { ExchangeModel } from "../src/modules/exchange/exchange.model";
import { PlayerModel } from "../src/modules/player/player.model";
import { DepositModel } from "../src/modules/deposit/deposit.model";
import { WithdrawalModel } from "../src/modules/withdrawal/withdrawal.model";
import { ExpenseModel } from "../src/modules/expense/expense.model";

describe("Dashboard P&L KPI structure integration", () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let superadminToken = "";
  let actorId = "";

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await bootstrapData();

    const loginRes = await request(app).post("/api/v1/auth/login").send({
      username: "superadmin",
      password: "SuperAdmin@123",
    });
    superadminToken = loginRes.body.data.accessToken;

    const actor = await UserModel.findOne({ username: "superadmin" }).select("_id").lean();
    actorId = String(actor!._id);

    const bank = await BankModel.create({
      holderName: "P&L Banker",
      bankName: "P&L Bank",
      accountNumber: "999888777666",
      ifsc: "PLBK0000123",
      openingBalance: 100000,
      currentBalance: 100000,
      status: "active",
      createdBy: actorId,
    });

    const exchange = await ExchangeModel.create({
      name: "P&L Exchange",
      provider: "P&L Provider",
      openingBalance: 0,
      currentBalance: 0,
      bonus: 0,
      status: "active",
      createdBy: actorId,
      updatedBy: actorId,
    });

    const player = await PlayerModel.create({
      exchange: exchange._id,
      playerId: "PL-PLAYER-001",
      phone: "9000000123",
      regularBonusPercentage: 5,
      firstDepositBonusPercentage: 10,
      createdBy: actorId,
      updatedBy: actorId,
    });

    const now = new Date();

    // Deposits: verified 1000 (settled) + pending 500 (not approved yet).
    await DepositModel.create([
      {
        bankId: bank._id,
        bankName: bank.bankName,
        utr: "PL-DEP-VERIFIED",
        amount: 1000,
        status: "verified",
        player: player._id,
        entryAt: now,
        settledAt: now,
        createdBy: actorId,
      },
      {
        bankId: bank._id,
        bankName: bank.bankName,
        utr: "PL-DEP-PENDING",
        amount: 500,
        status: "pending",
        player: player._id,
        entryAt: now,
        createdBy: actorId,
      },
    ]);

    // Withdrawals: approved 400 (settled) + requested 100 (pending).
    await WithdrawalModel.create([
      {
        player: player._id,
        playerName: "P&L Player",
        bankName: "Player Bank",
        amount: 400,
        payableAmount: 400,
        reverseBonus: 0,
        payoutBankId: bank._id,
        payoutBankName: bank.bankName,
        status: "approved",
        requestedAt: now,
        createdBy: actorId,
      },
      {
        player: player._id,
        playerName: "P&L Player",
        bankName: "Player Bank",
        amount: 100,
        payableAmount: 100,
        reverseBonus: 0,
        payoutBankId: bank._id,
        payoutBankName: bank.bankName,
        status: "requested",
        requestedAt: now,
        createdBy: actorId,
      },
    ]);


    // Expenses: approved 200 + pending 50 + cancelled 300 (cancelled must not count).
    await ExpenseModel.create([
      {
        expenseTypeId: new Types.ObjectId(),
        amount: 200,
        expenseDate: now,
        bankId: bank._id,
        bankName: bank.bankName,
        status: "approved",
        documents: [],
        createdBy: actorId,
      },
      {
        expenseTypeId: new Types.ObjectId(),
        amount: 50,
        expenseDate: now,
        bankId: bank._id,
        bankName: bank.bankName,
        status: "pending_audit",
        documents: [],
        createdBy: actorId,
      },
      {
        expenseTypeId: new Types.ObjectId(),
        amount: 300,
        expenseDate: now,
        bankId: bank._id,
        bankName: bank.bankName,
        status: "cancelled",
        documents: [],
        createdBy: actorId,
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  async function fetchSummary(query = "") {
    const res = await request(app)
      .get(`/api/v1/reports/dashboard-summary${query}`)
      .set("Authorization", `Bearer ${superadminToken}`);
    expect(res.status).toBe(200);
    return res.body.data;
  }

  it("exposes all-status headline P&L plus the approved-only portion", async () => {
    const data = await fetchSummary();

    expect(data.deposit.totalAmount).toBe(1500);
    expect(data.deposit.verifiedAmount).toBe(1000);
    expect(data.deposit.pendingAmount).toBe(500);

    expect(data.withdrawal.totalAmount).toBe(500);
    expect(data.withdrawal.approvedAmount).toBe(400);
    expect(data.withdrawal.pendingAmount).toBe(100);

    // Cancelled expenses never debited a bank, so they stay out of the totals.
    expect(data.expense.totalAmount).toBe(250);
    expect(data.expense.approvedAmount).toBe(200);
    expect(data.expense.pendingAmount).toBe(50);
    expect(data.expense.cancelledAmount).toBe(300);
    expect(data.expense.cancelledCount).toBe(1);

    // Headline = same basis as the Total Deposits / Withdrawals / Expenses cards.
    expect(data.pnl.grossAll).toBe(1000);
    expect(data.pnl.netAll).toBe(750);
    // Approved-only portion = the small footer figure.
    expect(data.pnl.gross).toBe(600);
    expect(data.pnl.net).toBe(400);

    expect(data.pnl.pendingGrossAmount).toBe(400);
    expect(data.pnl.pendingNetAmount).toBe(350);

    // Card arithmetic must hold exactly.
    expect(data.pnl.grossAll).toBe(data.deposit.totalAmount - data.withdrawal.totalAmount);
    expect(data.pnl.netAll).toBe(data.pnl.grossAll - data.expense.totalAmount);
    expect(data.pnl.gross).toBe(data.deposit.verifiedAmount - data.withdrawal.approvedAmount);
    expect(data.pnl.net).toBe(data.pnl.gross - data.expense.approvedAmount);
    expect(data.pnl.pendingGrossAmount).toBe(data.pnl.grossAll - data.pnl.gross);
    expect(data.pnl.pendingNetAmount).toBe(data.pnl.netAll - data.pnl.net);
  });

  it("collapses headline and approved figures when filtering by approved status", async () => {
    const data = await fetchSummary("?status=approved");

    expect(data.pnl.grossAll).toBe(data.pnl.gross);
    expect(data.pnl.netAll).toBe(data.pnl.net);
    expect(data.pnl.pendingGrossAmount).toBe(0);
    expect(data.pnl.pendingNetAmount).toBe(0);
  });
});

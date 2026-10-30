import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app";
import { bootstrapData } from "../src/shared/db/bootstrap";
import { signAccessToken } from "../src/shared/utils/jwt";
import { UserModel } from "../src/modules/users/user.model";
import { BankModel } from "../src/modules/bank/bank.model";
import { PERMISSIONS } from "../src/shared/constants/permissions";

function todayIstYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

describe("Bank transfer entry integration", () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let superadminToken = "";
  let actorId = "";
  let noPermToken = "";
  let fromBankId = "";
  let toBankId = "";

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

    const subNoPerm = await UserModel.create({
      fullName: "Transfer Sub No Perms",
      email: "transfer.sub.nop@example.com",
      username: "transfer_sub_nop",
      passwordHash: "not-used",
      role: "sub_admin",
      status: "active",
      // Deliberately missing bank.transfer
      permissions: [PERMISSIONS.BANK_LIST],
      timezone: "Asia/Kolkata",
      createdBy: actor!._id,
    });
    noPermToken = signAccessToken({
      userId: String(subNoPerm._id),
      role: "sub_admin",
      permissions: [PERMISSIONS.BANK_LIST],
      timezone: "Asia/Kolkata",
    });

    const fromBank = await BankModel.create({
      holderName: "Transfer From Holder",
      bankName: "Transfer From Bank",
      accountNumber: "111122223333",
      ifsc: "TRFR0000123",
      openingBalance: 10000,
      currentBalance: 10000,
      status: "active",
      createdBy: actorId,
    });
    fromBankId = String(fromBank._id);

    const toBank = await BankModel.create({
      holderName: "Transfer To Holder",
      bankName: "Transfer To Bank",
      accountNumber: "444455556666",
      ifsc: "TRTO0000123",
      openingBalance: 5000,
      currentBalance: 5000,
      status: "active",
      createdBy: actorId,
    });
    toBankId = String(toBank._id);
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  it("rejects a transfer from a bank to itself", async () => {
    const res = await request(app)
      .post("/api/v1/bank/transfers")
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({ fromBankId, toBankId: fromBankId, amount: 100, entryDate: todayIstYmd() });

    expect(res.status).toBe(400);
  });

  it("rejects a transfer that exceeds the source bank balance", async () => {
    const res = await request(app)
      .post("/api/v1/bank/transfers")
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({ fromBankId, toBankId, amount: 99_999, entryDate: todayIstYmd() });

    expect(res.status).toBe(400);
    expect(String(res.body.message ?? res.body.error?.message ?? "")).toMatch(/insufficient/i);
  });

  it("requires the bank.transfer permission", async () => {
    const res = await request(app)
      .post("/api/v1/bank/transfers")
      .set("Authorization", `Bearer ${noPermToken}`)
      .send({ fromBankId, toBankId, amount: 100, entryDate: todayIstYmd() });

    expect(res.status).toBe(403);
  });

  it("posts a bank→bank transfer and propagates to balances, statements and dashboard", async () => {
    const entryDate = todayIstYmd();

    const postRes = await request(app)
      .post("/api/v1/bank/transfers")
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({
        fromBankId,
        toBankId,
        amount: 1250,
        entryDate,
        referenceNo: "TRFR-REF-1",
        remark: "Integration transfer",
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.data.entryType).toBe("contra");
    expect(postRes.body.data.amount).toBe(1250);

    // ── 1. Live bank balances (both legs) ──────────────────────────
    const [fromBank, toBank] = await Promise.all([
      BankModel.findById(fromBankId).lean(),
      BankModel.findById(toBankId).lean(),
    ]);
    expect(fromBank?.currentBalance).toBe(8750);
    expect(toBank?.currentBalance).toBe(6250);

    // ── 2. Sender statement ────────────────────────────────────────
    const fromLedgerRes = await request(app)
      .get(`/api/v1/bank/${fromBankId}/ledger`)
      .set("Authorization", `Bearer ${superadminToken}`);
    expect(fromLedgerRes.status).toBe(200);
    const fromLedger = fromLedgerRes.body.data;
    expect(fromLedger.periodOpeningBalance).toBe(10000);
    expect(fromLedger.periodClosingBalance).toBe(8750);
    expect(fromLedger.totalDebits).toBe(1250);
    expect(fromLedger.totalCredits).toBe(0);
    expect(fromLedger.rows).toHaveLength(1);
    expect(fromLedger.rows[0]).toMatchObject({
      kind: "transfer",
      direction: "debit",
      amount: 1250,
      balanceAfter: 8750,
    });
    expect(String(fromLedger.rows[0].label)).toMatch(/Transfer to .*Transfer To Holder/);

    // ── 3. Receiver statement ──────────────────────────────────────
    const toLedgerRes = await request(app)
      .get(`/api/v1/bank/${toBankId}/ledger`)
      .set("Authorization", `Bearer ${superadminToken}`);
    expect(toLedgerRes.status).toBe(200);
    const toLedger = toLedgerRes.body.data;
    expect(toLedger.periodOpeningBalance).toBe(5000);
    expect(toLedger.periodClosingBalance).toBe(6250);
    expect(toLedger.totalCredits).toBe(1250);
    expect(toLedger.totalDebits).toBe(0);
    expect(toLedger.rows).toHaveLength(1);
    expect(toLedger.rows[0]).toMatchObject({
      kind: "transfer",
      direction: "credit",
      amount: 1250,
      balanceAfter: 6250,
    });
    expect(String(toLedger.rows[0].label)).toMatch(/Transfer from .*Transfer From Holder/);

    // ── 4. Transfer listing (drives the "Recent bank transfers" table) ──
    const listRes = await request(app)
      .get("/api/v1/bank/transfers")
      .set("Authorization", `Bearer ${superadminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.meta.total).toBe(1);
    expect(listRes.body.data[0]).toMatchObject({
      fromBankId,
      toBankId,
      amount: 1250,
      referenceNo: "TRFR-REF-1",
    });
    expect(String(listRes.body.data[0].fromBankName)).toContain("Transfer From Holder");
    expect(String(listRes.body.data[0].toBankName)).toContain("Transfer To Holder");

    // ── 5. Dashboard bank breakdown ────────────────────────────────
    const dashRes = await request(app)
      .get("/api/v1/reports/dashboard-summary")
      .set("Authorization", `Bearer ${superadminToken}`);
    expect(dashRes.status).toBe(200);
    const breakdown = dashRes.body.data.banksBreakdown as Array<Record<string, number | string>>;

    const fromRow = breakdown.find((b) => b.bankId === fromBankId);
    expect(fromRow).toBeDefined();
    expect(fromRow!.transferOut).toBe(1250);
    expect(fromRow!.transferOutCount).toBe(1);
    expect(fromRow!.transferIn).toBe(0);
    expect(fromRow!.closingBalance).toBe(8750);

    const toRow = breakdown.find((b) => b.bankId === toBankId);
    expect(toRow).toBeDefined();
    expect(toRow!.transferIn).toBe(1250);
    expect(toRow!.transferInCount).toBe(1);
    expect(toRow!.transferOut).toBe(0);
    expect(toRow!.closingBalance).toBe(6250);

    // Internal movement must never touch revenue-side KPIs.
    expect(dashRes.body.data.pnl.grossAll).toBe(0);
    expect(dashRes.body.data.pnl.netAll).toBe(0);
    expect(dashRes.body.data.deposit.totalAmount).toBe(0);
    expect(dashRes.body.data.withdrawal.totalAmount).toBe(0);
  });

});

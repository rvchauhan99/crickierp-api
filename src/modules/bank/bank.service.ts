import { Types } from "mongoose";
import type { z } from "zod";
import xlsx from "xlsx";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { DepositModel } from "../deposit/deposit.model";
import { WithdrawalModel } from "../withdrawal/withdrawal.model";
import { ExpenseModel } from "../expense/expense.model";
import { BankModel } from "./bank.model";
import { listBankQuerySchema } from "./bank.validation";

type ListBankQuery = z.infer<typeof listBankQuerySchema>;

function pageSizeFromQuery(q: ListBankQuery): number {
  return q.limit ?? q.pageSize;
}

function trimUndef(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  const t = String(s).trim();
  return t === "" ? undefined : t;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textFieldCondition(field: string, value: string, op: string | undefined): Record<string, unknown> {
  const operator = op || "contains";
  const esc = escapeRegex(value);
  switch (operator) {
    case "contains":
      return { [field]: { $regex: esc, $options: "i" } };
    case "notContains":
      return { [field]: { $not: new RegExp(esc, "i") } };
    case "equals":
      return { [field]: { $regex: `^${esc}$`, $options: "i" } };
    case "notEquals":
      return { [field]: { $not: new RegExp(`^${esc}$`, "i") } };
    case "startsWith":
      return { [field]: { $regex: `^${esc}`, $options: "i" } };
    case "endsWith":
      return { [field]: { $regex: `${esc}$`, $options: "i" } };
    default:
      return { [field]: { $regex: esc, $options: "i" } };
  }
}

function numberFieldCondition(
  field: string,
  value: string | undefined,
  op: string | undefined,
  valueTo: string | undefined,
): Record<string, unknown> | null {
  const v = trimUndef(value);
  if (v == null) return null;
  const num = Number(v);
  if (!Number.isFinite(num)) return null;
  const operator = op || "equals";
  const numToRaw = trimUndef(valueTo);
  const toNum = numToRaw != null ? Number(numToRaw) : NaN;

  switch (operator) {
    case "equals":
      return { [field]: num };
    case "notEquals":
      return { [field]: { $ne: num } };
    case "gt":
      return { [field]: { $gt: num } };
    case "gte":
      return { [field]: { $gte: num } };
    case "lt":
      return { [field]: { $lt: num } };
    case "lte":
      return { [field]: { $lte: num } };
    case "between":
      if (numToRaw != null && Number.isFinite(toNum)) {
        return { [field]: { $gte: Math.min(num, toNum), $lte: Math.max(num, toNum) } };
      }
      return { [field]: num };
    default:
      return { [field]: num };
  }
}

function ymdStart(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function ymdEnd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function createdAtCondition(
  from: string | undefined,
  to: string | undefined,
  op: string | undefined,
): Record<string, unknown> | null {
  const operator = op || "inRange";
  const f = trimUndef(from);
  const t = trimUndef(to);

  if (operator === "inRange" && f && t) {
    const start = ymdStart(f);
    const end = ymdEnd(t);
    if (!start || !end) return null;
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (operator === "equals" && f) {
    const start = ymdStart(f);
    const end = ymdEnd(f);
    if (!start || !end) return null;
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (operator === "before" && f) {
    const start = ymdStart(f);
    if (!start) return null;
    return { createdAt: { $lt: start } };
  }
  if (operator === "after" && f) {
    const end = ymdEnd(f);
    if (!end) return null;
    return { createdAt: { $gt: end } };
  }
  if (f && t) {
    const start = ymdStart(f);
    const end = ymdEnd(t);
    if (!start || !end) return null;
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (f) {
    const start = ymdStart(f);
    if (!start) return null;
    return { createdAt: { $gte: start } };
  }
  if (t) {
    const end = ymdEnd(t);
    if (!end) return null;
    return { createdAt: { $lte: end } };
  }
  return null;
}

function buildBankListFilter(q: ListBankQuery): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  const search = trimUndef(q.search);
  if (search) {
    const esc = escapeRegex(search);
    conditions.push({
      $or: [
        { holderName: { $regex: esc, $options: "i" } },
        { bankName: { $regex: esc, $options: "i" } },
        { accountNumber: { $regex: esc, $options: "i" } },
        { ifsc: { $regex: esc, $options: "i" } },
      ],
    });
  }

  const holderName = trimUndef(q.holderName);
  if (holderName) {
    conditions.push(textFieldCondition("holderName", holderName, trimUndef(q.holderName_op)));
  }

  const bankName = trimUndef(q.bankName);
  if (bankName) {
    conditions.push(textFieldCondition("bankName", bankName, trimUndef(q.bankName_op)));
  }

  const accountNumber = trimUndef(q.accountNumber);
  if (accountNumber) {
    conditions.push(textFieldCondition("accountNumber", accountNumber, trimUndef(q.accountNumber_op)));
  }

  const ifsc = trimUndef(q.ifsc);
  if (ifsc) {
    conditions.push(textFieldCondition("ifsc", ifsc, trimUndef(q.ifsc_op)));
  }

  const status = trimUndef(q.status);
  if (status === "active" || status === "deactive") {
    conditions.push({ status });
  }

  const createdBy = trimUndef(q.createdBy);
  if (createdBy && Types.ObjectId.isValid(createdBy)) {
    conditions.push({ createdBy: new Types.ObjectId(createdBy) });
  }

  const dateCond = createdAtCondition(
    trimUndef(q.createdAt_from),
    trimUndef(q.createdAt_to),
    trimUndef(q.createdAt_op),
  );
  if (dateCond) {
    conditions.push(dateCond);
  }

  const ob = numberFieldCondition(
    "openingBalance",
    trimUndef(q.openingBalance),
    trimUndef(q.openingBalance_op),
    trimUndef(q.openingBalance_to),
  );
  if (ob) {
    conditions.push(ob);
  }

  if (conditions.length === 0) {
    return {};
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return { $and: conditions };
}

const EXPORT_MAX_ROWS = 10_000;

function formatCreatedByForExport(createdBy: unknown): string {
  if (createdBy == null) return "";
  if (typeof createdBy === "object" && createdBy !== null && "_id" in createdBy) {
    const u = createdBy as { fullName?: string; username?: string; _id?: Types.ObjectId };
    const fn = u.fullName?.trim();
    const un = u.username?.trim();
    if (fn && un) return `${fn} (${un})`;
    if (fn) return fn;
    if (un) return un;
    return u._id?.toString() ?? "";
  }
  return String(createdBy);
}

export async function createBank(input: {
  holderName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  openingBalance: number;
  status: "active" | "deactive";
}, actorId: string, requestId?: string) {
  const existing = await BankModel.findOne({ accountNumber: input.accountNumber });
  if (existing) throw new AppError("business_rule_error", "Account number already exists", 409);
  const doc = await BankModel.create({
    ...input,
    currentBalance: input.openingBalance,
    createdBy: new Types.ObjectId(actorId),
  });
  await createAuditLog({
    actorId,
    action: "bank.create",
    entity: "bank",
    entityId: doc._id.toString(),
    newValue: input as unknown as Record<string, unknown>,
    requestId,
  });
  return doc;
}

export async function listBanks(query: ListBankQuery) {
  const filter = buildBankListFilter(query);
  const page = query.page;
  const pageSize = pageSizeFromQuery(query);
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const [rows, total] = await Promise.all([
    BankModel.find(filter)
      .populate("createdBy", "fullName username")
      .sort({ [query.sortBy]: sortValue })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    BankModel.countDocuments(filter),
  ]);

  return {
    rows,
    meta: {
      page,
      pageSize,
      total,
    },
  };
}

export async function exportBanksToBuffer(query: ListBankQuery): Promise<Buffer> {
  const filter = buildBankListFilter(query);
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const rows = await BankModel.find(filter)
    .populate("createdBy", "fullName username")
    .sort({ [query.sortBy]: sortValue })
    .limit(EXPORT_MAX_ROWS)
    .lean();

  const exportData = rows.map((r) => ({
    "Holder Name": r.holderName,
    "Bank Name": r.bankName,
    "Account Number": r.accountNumber,
    IFSC: r.ifsc,
    "Opening Balance": r.openingBalance,
    Status: r.status,
    "Created By": formatCreatedByForExport(r.createdBy),
    "Created At": r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }));

  const worksheet = xlsx.utils.json_to_sheet(exportData);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Banks");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

type LedgerQuery = {
  fromDate?: string;
  toDate?: string;
  entryType?: "all" | "deposit" | "withdrawal" | "expense";
};

function ledgerYmdStart(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function ledgerYmdEnd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function depositEventTime(d: { settledAt?: Date; createdAt?: Date }): Date {
  if (d.settledAt) return new Date(d.settledAt);
  if (d.createdAt) return new Date(d.createdAt);
  return new Date(0);
}

function withdrawalEventTime(w: { updatedAt?: Date; createdAt?: Date }): Date {
  if (w.updatedAt) return new Date(w.updatedAt);
  if (w.createdAt) return new Date(w.createdAt);
  return new Date(0);
}

function expenseEventTime(e: { approvedAt?: Date; createdAt?: Date }): Date {
  if (e.approvedAt) return new Date(e.approvedAt);
  if (e.createdAt) return new Date(e.createdAt);
  return new Date(0);
}

/** Merged deposit credits, withdrawal debits, and approved expense debits for a bank account (chronological ledger). */
export async function getBankLedger(bankId: string, query: LedgerQuery) {
  if (!Types.ObjectId.isValid(bankId)) {
    throw new AppError("validation_error", "Invalid bank id", 400);
  }
  const bid = new Types.ObjectId(bankId);
  const bank = await BankModel.findById(bid).lean();
  if (!bank) throw new AppError("not_found", "Bank not found", 404);

  const from = query.fromDate?.trim();
  const to = query.toDate?.trim();
  const fromD = from ? ledgerYmdStart(from) : null;
  const toD = to ? ledgerYmdEnd(to) : null;
  const entryType = query.entryType || "all";

  const [allDeposits, allWithdrawals, allExpenses] = await Promise.all([
    DepositModel.find({ bankId: bid, status: "verified" })
      .populate("player", "name")
      .populate("createdBy", "fullName")
      .lean(),
    WithdrawalModel.find({ payoutBankId: bid, status: "finalized" })
      .populate("player", "name")
      .populate("createdBy", "fullName")
      .lean(),
    ExpenseModel.find({ bankId: bid, status: "approved" }).lean(),
  ]);

  let priorNet = 0;
  if (fromD) {
    for (const d of allDeposits) {
      const at = depositEventTime(d);
      if (at >= fromD) continue;
      // Bonus is OFF balance sheet
      priorNet += d.amount;
    }
    for (const w of allWithdrawals) {
      const at = withdrawalEventTime(w);
      if (at >= fromD) continue;
      // Bonus is OFF balance sheet, so liability is what actually went out
      priorNet -= w.payableAmount ?? w.amount;
    }
    for (const e of allExpenses) {
      const at = expenseEventTime(e);
      if (at >= fromD) continue;
      priorNet -= e.amount;
    }
  }

  type Ev =
    | { kind: "deposit"; t: number; doc: (typeof allDeposits)[0] }
    | { kind: "withdrawal"; t: number; doc: (typeof allWithdrawals)[0] }
    | { kind: "expense"; t: number; doc: (typeof allExpenses)[0] };

  const events: Ev[] = [];
  for (const d of allDeposits) {
    const at = depositEventTime(d);
    if (fromD && at < fromD) continue;
    if (toD && at > toD) continue;
    if (entryType === "all" || entryType === "deposit") {
      events.push({ kind: "deposit", t: at.getTime(), doc: d });
    }
  }
  for (const w of allWithdrawals) {
    const at = withdrawalEventTime(w);
    if (fromD && at < fromD) continue;
    if (toD && at > toD) continue;
    if (entryType === "all" || entryType === "withdrawal") {
      events.push({ kind: "withdrawal", t: at.getTime(), doc: w });
    }
  }
  for (const e of allExpenses) {
    const at = expenseEventTime(e);
    if (fromD && at < fromD) continue;
    if (toD && at > toD) continue;
    if (entryType === "all" || entryType === "expense") {
      events.push({ kind: "expense", t: at.getTime(), doc: e });
    }
  }
  events.sort((a, b) => a.t - b.t);

  const periodOpeningBalance = bank.openingBalance + priorNet;
  let running = periodOpeningBalance;
  let totalCredits = 0;
  let totalDebits = 0;
  let totalBonusGiven = 0;
  let totalBonusReversed = 0;

  const rows = events.map((ev) => {
    if (ev.kind === "deposit") {
      const d = ev.doc;
      const amt = d.amount; // Base amount only (cash in bank)
      const bonus = d.bonusAmount ?? 0;
      running += amt;
      totalCredits += amt;
      totalBonusGiven += bonus;
      
      const playerObj = d.player as { name?: string } | undefined;
      const createdByObj = d.createdBy as { fullName?: string } | undefined;

      return {
        kind: "deposit" as const,
        refId: d._id.toString(),
        at: new Date(ev.t).toISOString(),
        label: `Deposit`,
        utr: d.utr,
        playerName: playerObj?.name ?? "",
        createdByName: createdByObj?.fullName ?? "",
        amount: amt,
        direction: "credit" as const,
        balanceAfter: running,
        bonusMemo: bonus > 0 ? bonus : undefined,
      };
    }
    
    if (ev.kind === "withdrawal") {
      const w = ev.doc;
      const amt = w.payableAmount ?? w.amount; // Actual cash paid
      const reversal = w.reverseBonus ?? 0;
      running -= amt;
      totalDebits += amt;
      totalBonusReversed += reversal;

      const playerObj = w.player as { name?: string } | undefined;
      const createdByObj = w.createdBy as { fullName?: string } | undefined;

      return {
        kind: "withdrawal" as const,
        refId: w._id.toString(),
        at: new Date(ev.t).toISOString(),
        label: `Withdrawal`,
        utr: w.utr,
        playerName: playerObj?.name ?? w.playerName ?? "",
        createdByName: createdByObj?.fullName ?? "",
        amount: amt,
        direction: "debit" as const,
        balanceAfter: running,
        bonusMemo: reversal > 0 ? reversal : undefined,
      };
    }
    
    // expense
    const e = ev.doc;
    running -= e.amount;
    totalDebits += e.amount;
    return {
      kind: "expense" as const,
      refId: e._id.toString(),
      at: new Date(ev.t).toISOString(),
      label: e.description?.trim() ? e.description.trim() : "Expense",
      utr: undefined,
      playerName: "",
      createdByName: "",
      amount: e.amount,
      direction: "debit" as const,
      balanceAfter: running,
      bonusMemo: undefined,
    };
  });

  return {
    bank: {
      _id: bank._id.toString(),
      holderName: bank.holderName,
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      openingBalance: bank.openingBalance,
      currentBalance: bank.currentBalance ?? bank.openingBalance,
    },
    periodOpeningBalance,
    periodClosingBalance: running,
    totalCredits,
    totalDebits,
    totalBonusGiven,
    totalBonusReversed,
    rows,
  };
}

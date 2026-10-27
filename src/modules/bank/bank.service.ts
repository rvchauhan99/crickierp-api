import { Types } from "mongoose";
import type { z } from "zod";
import { generateExcelBuffer, generateMultiSheetExcelBuffer } from "../../shared/services/excel.service";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { DepositModel } from "../deposit/deposit.model";
import { WithdrawalModel } from "../withdrawal/withdrawal.model";
import { ExpenseModel } from "../expense/expense.model";
import { LiabilityEntryModel } from "../liability/liability-entry.model";
import { LiabilityPersonModel } from "../liability/liability-person.model";
import { createLiabilityEntry } from "../liability/liability.service";
import {
  DEFAULT_TIMEZONE,
  formatDateTimeForTimeZone,
  ymdToUtcEnd,
  ymdToUtcStart,
} from "../../shared/utils/timezone";
import { BankModel } from "./bank.model";
import { BankBalanceSettlementModel } from "./bank-balance-settlement.model";
import { computeClosingBalanceActualByBankIds } from "./bankClosingBalance";
import {
  bankSummaryQuerySchema,
  listBankQuerySchema,
  listBankTransferQuerySchema,
} from "./bank.validation";
import { resolveOpeningMoneyFromRequest } from "../../shared/utils/moneyFx";
import { getBanksBreakdownSummary } from "../reports/reports.service";

type ListBankQuery = z.infer<typeof listBankQuerySchema>;
type BankSummaryQuery = z.infer<typeof bankSummaryQuerySchema>;
type ListBankTransferQuery = z.infer<typeof listBankTransferQuerySchema>;

function isBankToBankLiability(le: {
  fromAccountType?: string;
  toAccountType?: string;
}): boolean {
  return le.fromAccountType === "bank" && le.toAccountType === "bank";
}

function bankDisplayLabel(b: {
  holderName?: string;
  bankName?: string;
  accountNumber?: string;
}): string {
  const tail = b.accountNumber ? ` (${String(b.accountNumber).slice(-4)})` : "";
  return `${b.holderName ?? ""} — ${b.bankName ?? ""}${tail}`.trim();
}

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

function createdAtCondition(
  from: string | undefined,
  to: string | undefined,
  op: string | undefined,
  timeZone: string,
): Record<string, unknown> | null {
  const operator = op || "inRange";
  const f = trimUndef(from);
  const t = trimUndef(to);

  if (operator === "inRange" && f && t) {
    const start = ymdToUtcStart(f, timeZone);
    const end = ymdToUtcEnd(t, timeZone);
    if (!start || !end) return null;
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (operator === "equals" && f) {
    const start = ymdToUtcStart(f, timeZone);
    const end = ymdToUtcEnd(f, timeZone);
    if (!start || !end) return null;
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (operator === "before" && f) {
    const start = ymdToUtcStart(f, timeZone);
    if (!start) return null;
    return { createdAt: { $lt: start } };
  }
  if (operator === "after" && f) {
    const end = ymdToUtcEnd(f, timeZone);
    if (!end) return null;
    return { createdAt: { $gt: end } };
  }
  if (f && t) {
    const start = ymdToUtcStart(f, timeZone);
    const end = ymdToUtcEnd(t, timeZone);
    if (!start || !end) return null;
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (f) {
    const start = ymdToUtcStart(f, timeZone);
    if (!start) return null;
    return { createdAt: { $gte: start } };
  }
  if (t) {
    const end = ymdToUtcEnd(t, timeZone);
    if (!end) return null;
    return { createdAt: { $lte: end } };
  }
  return null;
}

function buildBankListFilter(q: ListBankQuery, timeZone: string): Record<string, unknown> {
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
    timeZone,
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
  openingOperatedCurrency?: string;
  openingOperatedAmount?: number;
  openingExchangeRate?: number;
}, actorId: string, requestId?: string) {
  const existing = await BankModel.findOne({ accountNumber: input.accountNumber });
  if (existing) throw new AppError("business_rule_error", "Account number already exists", 409);
  const opening = await resolveOpeningMoneyFromRequest({
    openingBalance: input.openingBalance,
    openingOperatedCurrency: input.openingOperatedCurrency,
    openingOperatedAmount: input.openingOperatedAmount,
    openingExchangeRate: input.openingExchangeRate,
  });
  const doc = await BankModel.create({
    holderName: input.holderName,
    bankName: input.bankName,
    accountNumber: input.accountNumber,
    ifsc: input.ifsc,
    status: input.status,
    openingBalance: opening.openingBalance,
    openingOperatedCurrency: opening.openingOperatedCurrency,
    openingOperatedAmount: opening.openingOperatedAmount,
    openingExchangeRate: opening.openingExchangeRate,
    currentBalance: opening.openingBalance,
    createdBy: new Types.ObjectId(actorId),
  });
  await createAuditLog({
    actorId,
    action: "bank.create",
    entity: "bank",
    entityId: doc._id.toString(),
    newValue: {
      holderName: input.holderName,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      ifsc: input.ifsc,
      openingBalance: opening.openingBalance,
      openingOperatedCurrency: opening.openingOperatedCurrency,
      openingOperatedAmount: opening.openingOperatedAmount,
      openingExchangeRate: opening.openingExchangeRate,
      status: input.status,
    } as unknown as Record<string, unknown>,
    requestId,
  });
  return doc;
}

export async function listBanks(query: ListBankQuery, options?: { timeZone?: string }) {
  const timeZone = options?.timeZone || DEFAULT_TIMEZONE;
  const filter = buildBankListFilter(query, timeZone);
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

  const bankIds = rows.map((r) => new Types.ObjectId(String(r._id)));
  const closingByBankId = await computeClosingBalanceActualByBankIds(bankIds);
  const rowsWithClosing = rows.map((r) => ({
    ...r,
    closingBalanceActual: closingByBankId.get(String(r._id)) ?? Number(r.openingBalance ?? 0),
  }));

  return {
    rows: rowsWithClosing,
    meta: {
      page,
      pageSize,
      total,
    },
  };
}

export async function exportBanksToBuffer(
  query: ListBankQuery,
  options?: { timeZone?: string },
): Promise<Buffer> {
  const timeZone = options?.timeZone || DEFAULT_TIMEZONE;
  const filter = buildBankListFilter(query, timeZone);
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const rows = await BankModel.find(filter)
    .populate("createdBy", "fullName username")
    .sort({ [query.sortBy]: sortValue })
    .limit(EXPORT_MAX_ROWS)
    .lean();

  return generateExcelBuffer(rows, [
    { header: "Holder Name", key: "holderName" },
    { header: "Bank Name", key: "bankName" },
    { header: "Account Number", key: "accountNumber" },
    { header: "IFSC", key: "ifsc" },
    { header: "Opening Balance", key: "openingBalance" },
    { header: "Status", key: "status" },
    { header: "Created By", transform: (r) => formatCreatedByForExport(r.createdBy) },
    { header: "Created At", transform: (r) => formatDateTimeForTimeZone(r.createdAt, timeZone) },
  ], "Banks");
}

type LedgerQuery = {
  fromDate?: string;
  toDate?: string;
  entryType?: "all" | "deposit" | "withdrawal" | "expense" | "liability" | "transfer" | "settlement";
};

function settlementEventTime(s: { effectiveAt: Date }): Date {
  return new Date(s.effectiveAt);
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

function liabilityEventTime(e: { entryDate?: Date; createdAt?: Date }): Date {
  if (e.entryDate) return new Date(e.entryDate);
  if (e.createdAt) return new Date(e.createdAt);
  return new Date(0);
}

/**
 * Merged deposit credits, withdrawal debits, and approved expense debits for a bank account (chronological ledger).
 * Withdrawal rows are sourced from banker-paid entries (status: approved) for the selected payout bank.
 * Reverse bonus is memo-only and never posted as a separate cash ledger row.
 */
export async function getBankLedger(bankId: string, query: LedgerQuery, options?: { timeZone?: string }) {
  const timeZone = options?.timeZone || DEFAULT_TIMEZONE;
  if (!Types.ObjectId.isValid(bankId)) {
    throw new AppError("validation_error", "Invalid bank id", 400);
  }
  const bid = new Types.ObjectId(bankId);
  const bank = await BankModel.findById(bid).lean();
  if (!bank) throw new AppError("not_found", "Bank not found", 404);

  const from = query.fromDate?.trim();
  const to = query.toDate?.trim();
  const fromD = from ? ymdToUtcStart(from, timeZone) : null;
  const toD = to ? ymdToUtcEnd(to, timeZone) : null;
  const entryType = query.entryType || "all";

  const [allDeposits, allWithdrawals, allExpenses, allLiabilityEntries, allSettlements] = await Promise.all([
    DepositModel.find({ bankId: bid, status: "verified" })
      .populate("player", "name")
      .populate("createdBy", "fullName")
      .lean(),
    WithdrawalModel.find({ payoutBankId: bid, status: "approved" })
      .populate("player", "name")
      .populate("createdBy", "fullName")
      .lean(),
    ExpenseModel.find({ bankId: bid, status: "approved" }).lean(),
    LiabilityEntryModel.find({
      $or: [
        { fromAccountType: "bank", fromAccountId: bid },
        { toAccountType: "bank", toAccountId: bid },
      ],
    })
      .populate("createdBy", "fullName")
      .lean(),
    BankBalanceSettlementModel.find({ bankId: bid })
      .populate("createdBy", "fullName username")
      .lean(),
  ]);

  const liabilityPersonIds = new Set<string>();
  const liabilityBankIds = new Set<string>();
  for (const e of allLiabilityEntries) {
    if (e.fromAccountType === "person") liabilityPersonIds.add(String(e.fromAccountId));
    if (e.toAccountType === "person") liabilityPersonIds.add(String(e.toAccountId));
    if (e.fromAccountType === "bank") liabilityBankIds.add(String(e.fromAccountId));
    if (e.toAccountType === "bank") liabilityBankIds.add(String(e.toAccountId));
  }
  const [liabilityPersons, liabilityBanks] = await Promise.all([
    LiabilityPersonModel.find({
      _id: {
        $in: [...liabilityPersonIds]
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id)),
      },
    })
      .select("_id name")
      .lean(),
    BankModel.find({
      _id: {
        $in: [...liabilityBankIds]
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id)),
      },
    })
      .select("_id holderName bankName accountNumber")
      .lean(),
  ]);
  const liabilityPersonMap = new Map(liabilityPersons.map((p) => [String(p._id), p.name]));
  const liabilityBankMap = new Map(
    liabilityBanks.map((b) => [String(b._id), bankDisplayLabel(b)]),
  );

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
      // Reverse bonus stays memo-only; cash movement is payable amount only.
      priorNet -= w.payableAmount ?? w.amount;
    }
    for (const e of allExpenses) {
      const at = expenseEventTime(e);
      if (at >= fromD) continue;
      priorNet -= e.amount;
    }
    for (const le of allLiabilityEntries) {
      const at = liabilityEventTime(le);
      if (at >= fromD) continue;
      const isBankFrom = le.fromAccountType === "bank" && String(le.fromAccountId) === String(bid);
      const isBankTo = le.toAccountType === "bank" && String(le.toAccountId) === String(bid);
      if (isBankFrom) priorNet -= le.amount;
      if (isBankTo) priorNet += le.amount;
    }
    for (const st of allSettlements) {
      const at = settlementEventTime(st);
      if (at >= fromD) continue;
      priorNet += Number(st.signedAmount ?? 0);
    }
  }

  type SettlementLean = (typeof allSettlements)[number];

  type Ev =
    | { kind: "deposit"; t: number; doc: (typeof allDeposits)[0] }
    | { kind: "withdrawal"; t: number; doc: (typeof allWithdrawals)[0] }
    | { kind: "expense"; t: number; doc: (typeof allExpenses)[0] }
    | { kind: "liability"; t: number; doc: (typeof allLiabilityEntries)[0] }
    | { kind: "settlement"; t: number; doc: SettlementLean };

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
  for (const le of allLiabilityEntries) {
    const at = liabilityEventTime(le);
    if (fromD && at < fromD) continue;
    if (toD && at > toD) continue;
    const bankToBank = isBankToBankLiability(le);
    if (
      entryType === "all" ||
      entryType === "liability" ||
      (entryType === "transfer" && bankToBank)
    ) {
      events.push({ kind: "liability", t: at.getTime(), doc: le });
    }
  }
  for (const st of allSettlements) {
    const at = settlementEventTime(st);
    if (fromD && at < fromD) continue;
    if (toD && at > toD) continue;
    if (entryType === "all" || entryType === "settlement") {
      events.push({ kind: "settlement", t: at.getTime(), doc: st });
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
        at: formatDateTimeForTimeZone(new Date(ev.t), timeZone),
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
      const amt = w.payableAmount ?? w.amount; // Actual cash paid from company bank
      const reversal = w.reverseBonus ?? 0;
      running -= amt;
      totalDebits += amt;
      totalBonusReversed += reversal;

      const playerObj = w.player as { name?: string } | undefined;
      const createdByObj = w.createdBy as { fullName?: string } | undefined;

      return {
        kind: "withdrawal" as const,
        refId: w._id.toString(),
        at: formatDateTimeForTimeZone(new Date(ev.t), timeZone),
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
    
    if (ev.kind === "liability") {
      const le = ev.doc;
      const isBankFrom = le.fromAccountType === "bank" && String(le.fromAccountId) === String(bid);
      const direction = isBankFrom ? "debit" : "credit";
      if (direction === "debit") {
        running -= le.amount;
        totalDebits += le.amount;
      } else {
        running += le.amount;
        totalCredits += le.amount;
      }
      const createdByObj = le.createdBy as { fullName?: string } | undefined;
      const bankToBank = isBankToBankLiability(le);
      let counterpartyName = "";
      let label = `Liability ${le.entryType}`;
      if (bankToBank) {
        const otherId = isBankFrom ? String(le.toAccountId) : String(le.fromAccountId);
        counterpartyName = liabilityBankMap.get(otherId) ?? "";
        label = isBankFrom
          ? `Transfer to ${counterpartyName || "bank"}`
          : `Transfer from ${counterpartyName || "bank"}`;
      } else if (le.fromAccountType === "person") {
        counterpartyName = liabilityPersonMap.get(String(le.fromAccountId)) ?? "";
      } else if (le.toAccountType === "person") {
        counterpartyName = liabilityPersonMap.get(String(le.toAccountId)) ?? "";
      }
      return {
        kind: (bankToBank ? "transfer" : "liability") as "liability" | "transfer",
        refId: le._id.toString(),
        at: formatDateTimeForTimeZone(new Date(ev.t), timeZone),
        label,
        utr: le.referenceNo?.trim() || undefined,
        playerName: counterpartyName,
        createdByName: createdByObj?.fullName ?? "",
        amount: le.amount,
        direction,
        balanceAfter: running,
        bonusMemo: undefined,
      };
    }

    if (ev.kind === "settlement") {
      const st = ev.doc;
      const signed = Number(st.signedAmount ?? 0);
      const amt = Math.abs(signed);
      if (signed >= 0) {
        running += amt;
        totalCredits += amt;
      } else {
        running -= amt;
        totalDebits += amt;
      }
      const createdByObj = st.createdBy as { fullName?: string; username?: string } | undefined;
      const createdLabel = createdByObj?.fullName?.trim()
        ? createdByObj.fullName.trim()
        : createdByObj?.username?.trim() ?? "";
      return {
        kind: "settlement" as const,
        refId: st._id.toString(),
        at: formatDateTimeForTimeZone(new Date(ev.t), timeZone),
        label: "Master balance settlement",
        utr: undefined,
        playerName: st.reason?.trim() ? st.reason.trim().slice(0, 200) : "",
        createdByName: createdLabel,
        amount: amt,
        direction: signed >= 0 ? ("credit" as const) : ("debit" as const),
        balanceAfter: running,
        bonusMemo: undefined,
      };
    }

    // expense
    const e = ev.doc;
    running -= e.amount;
    totalDebits += e.amount;
    return {
      kind: "expense" as const,
      refId: e._id.toString(),
      at: formatDateTimeForTimeZone(new Date(ev.t), timeZone),
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

export async function exportBankLedgerToBuffer(
  bankId: string,
  query: LedgerQuery,
  options?: { timeZone?: string },
): Promise<Buffer> {
  const ledger = await getBankLedger(bankId, query, options);
  const periodLabel = [query.fromDate?.trim() || "Start", query.toDate?.trim() || "Today"].join(" to ");

  const summaryData = [
    { Field: "Holder Name", Value: ledger.bank.holderName },
    { Field: "Bank Name", Value: ledger.bank.bankName },
    { Field: "Account Number", Value: ledger.bank.accountNumber },
    { Field: "Period", Value: periodLabel },
    { Field: "Entry Type Filter", Value: query.entryType || "all" },
    { Field: "Opening Balance", Value: ledger.periodOpeningBalance },
    { Field: "Total Credits", Value: ledger.totalCredits },
    { Field: "Total Debits", Value: ledger.totalDebits },
    { Field: "Closing Balance", Value: ledger.periodClosingBalance },
    { Field: "Bonus Given", Value: ledger.totalBonusGiven },
    { Field: "Bonus Reversed", Value: ledger.totalBonusReversed },
  ];

  const txnData = ledger.rows.map((r) => ({
    at: r.at,
    kind: r.kind,
    label: r.label,
    utr: r.utr ?? "",
    playerName: r.playerName ?? "",
    createdByName: r.createdByName ?? "",
    credit: r.direction === "credit" ? r.amount : "",
    debit: r.direction === "debit" ? r.amount : "",
    balanceAfter: r.balanceAfter,
    bonusMemo: r.bonusMemo ?? "",
  }));

  return generateMultiSheetExcelBuffer([
    {
      name: "Summary",
      data: summaryData,
      columns: [
        { header: "Field", key: "Field" },
        { header: "Value", key: "Value" },
      ],
    },
    {
      name: "Transactions",
      data: txnData,
      columns: [
        { header: "Date & Time", key: "at" },
        { header: "Type", key: "kind" },
        { header: "Description", key: "label" },
        { header: "UTR", key: "utr" },
        { header: "Player / Ref", key: "playerName" },
        { header: "Created By", key: "createdByName" },
        { header: "Credit", key: "credit" },
        { header: "Debit", key: "debit" },
        { header: "Balance", key: "balanceAfter" },
        { header: "Bonus Memo", key: "bonusMemo" },
      ],
    },
  ]);
}

export type CreateBankSettlementInput = {
  effectiveAt: Date;
  masterReportedBalance: number;
  reason: string;
};

export async function getBankComputedClosingBalance(bankId: string): Promise<{ systemClosingBalance: number }> {
  if (!Types.ObjectId.isValid(bankId)) {
    throw new AppError("validation_error", "Invalid bank id", 400);
  }
  const bid = new Types.ObjectId(bankId);
  const bank = await BankModel.findById(bid).select("_id").lean();
  if (!bank) throw new AppError("not_found", "Bank not found", 404);
  const m = await computeClosingBalanceActualByBankIds([bid]);
  return { systemClosingBalance: Number(m.get(bankId) ?? 0) };
}

export async function listBankSettlements(bankId: string) {
  if (!Types.ObjectId.isValid(bankId)) {
    throw new AppError("validation_error", "Invalid bank id", 400);
  }
  const bid = new Types.ObjectId(bankId);
  const bank = await BankModel.findById(bid).select("_id").lean();
  if (!bank) throw new AppError("not_found", "Bank not found", 404);
  return BankBalanceSettlementModel.find({ bankId: bid })
    .sort({ effectiveAt: -1 })
    .limit(100)
    .populate("createdBy", "fullName username")
    .lean();
}

export async function getBankSummary(query: BankSummaryQuery, options?: { timeZone?: string }) {
  return getBanksBreakdownSummary(query, options);
}

export async function createBankSettlement(
  bankId: string,
  input: CreateBankSettlementInput,
  actorId: string,
  requestId?: string,
) {
  if (!Types.ObjectId.isValid(bankId)) {
    throw new AppError("validation_error", "Invalid bank id", 400);
  }
  const bid = new Types.ObjectId(bankId);
  const bank = await BankModel.findById(bid).lean();
  if (!bank) throw new AppError("not_found", "Bank not found", 404);

  const master = Number(input.masterReportedBalance);
  if (!Number.isFinite(master) || master < 0) {
    throw new AppError("validation_error", "masterReportedBalance must be a non-negative finite number", 400);
  }

  const closingMap = await computeClosingBalanceActualByBankIds([bid]);
  const systemBalanceBefore = Number(closingMap.get(bankId) ?? 0);
  const signedAmount = master - systemBalanceBefore;
  if (!Number.isFinite(signedAmount) || Math.abs(signedAmount) < 1e-9) {
    throw new AppError(
      "business_rule_error",
      "Nothing to settle: master balance already matches the system-computed balance.",
      400,
    );
  }

  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new AppError("validation_error", "Reason must be at least 3 characters", 400);
  }

  const doc = await BankBalanceSettlementModel.create({
    bankId: bid,
    effectiveAt: input.effectiveAt,
    masterReportedBalance: master,
    signedAmount,
    systemBalanceBefore,
    reason,
    createdBy: new Types.ObjectId(actorId),
  });

  await BankModel.updateOne({ _id: bid }, { $set: { currentBalance: master } });

  await createAuditLog({
    actorId,
    action: "bank.settlement.create",
    entity: "bank",
    entityId: bankId,
    newValue: {
      masterReportedBalance: master,
      signedAmount,
      systemBalanceBefore,
      reason,
      effectiveAt: input.effectiveAt.toISOString(),
      settlementId: doc._id.toString(),
    },
    requestId,
  });

  return doc.toObject();
}

export async function createBankTransfer(
  input: {
    fromBankId: string;
    toBankId: string;
    amount: number;
    entryDate: string;
    referenceNo?: string;
    remark?: string;
    operatedCurrency?: string;
    operatedAmount?: number;
    exchangeRate?: number;
  },
  actorId: string,
  requestId?: string,
) {
  if (input.fromBankId === input.toBankId) {
    throw new AppError("business_rule_error", "From bank and To bank must be different", 400);
  }

  const doc = await createLiabilityEntry(
    {
      entryDate: input.entryDate,
      entryType: "contra",
      amount: input.amount,
      operatedCurrency: input.operatedCurrency,
      operatedAmount: input.operatedAmount,
      exchangeRate: input.exchangeRate,
      fromAccountType: "bank",
      fromAccountId: input.fromBankId,
      toAccountType: "bank",
      toAccountId: input.toBankId,
      referenceNo: input.referenceNo,
      remark: input.remark,
    },
    actorId,
    requestId,
  );

  await createAuditLog({
    actorId,
    action: "bank.transfer.create",
    entity: "liability_entry",
    entityId: doc._id.toString(),
    newValue: {
      fromBankId: input.fromBankId,
      toBankId: input.toBankId,
      amount: Number(doc.amount),
      entryDate: input.entryDate,
      referenceNo: input.referenceNo?.trim() || undefined,
      remark: input.remark?.trim() || undefined,
    },
    requestId,
  });

  return doc;
}

export async function listBankTransfers(
  query: ListBankTransferQuery,
  options?: { timeZone?: string },
) {
  const timeZone = options?.timeZone || DEFAULT_TIMEZONE;
  const page = query.page;
  const pageSize = query.limit ?? query.pageSize;
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const conditions: Record<string, unknown>[] = [
    { fromAccountType: "bank", toAccountType: "bank" },
  ];

  const bankId = trimUndef(query.bankId);
  if (bankId && Types.ObjectId.isValid(bankId)) {
    const bid = new Types.ObjectId(bankId);
    conditions.push({
      $or: [{ fromAccountId: bid }, { toAccountId: bid }],
    });
  }

  const search = trimUndef(query.search);
  if (search) {
    const esc = escapeRegex(search);
    conditions.push({
      $or: [
        { referenceNo: { $regex: esc, $options: "i" } },
        { remark: { $regex: esc, $options: "i" } },
      ],
    });
  }

  const from = trimUndef(query.entryDate_from);
  const to = trimUndef(query.entryDate_to);
  const fromD = from ? ymdToUtcStart(from, timeZone) : null;
  const toD = to ? ymdToUtcEnd(to, timeZone) : null;
  if (fromD || toD) {
    conditions.push({
      entryDate: {
        ...(fromD ? { $gte: fromD } : {}),
        ...(toD ? { $lte: toD } : {}),
      },
    });
  }

  const filter = { $and: conditions };

  const [rows, total] = await Promise.all([
    LiabilityEntryModel.find(filter)
      .populate("createdBy", "fullName username")
      .sort({ [query.sortBy]: sortValue })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    LiabilityEntryModel.countDocuments(filter),
  ]);

  const accountIds = new Set<string>();
  rows.forEach((r) => {
    accountIds.add(String(r.fromAccountId));
    accountIds.add(String(r.toAccountId));
  });
  const banks = await BankModel.find({
    _id: {
      $in: [...accountIds]
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id)),
    },
  })
    .select("_id holderName bankName accountNumber")
    .lean();
  const bankMap = new Map(banks.map((b) => [String(b._id), bankDisplayLabel(b)]));

  const mapped = rows.map((r) => {
    const fromId = String(r.fromAccountId);
    const toId = String(r.toAccountId);
    return {
      ...r,
      id: String(r._id),
      fromBankId: fromId,
      toBankId: toId,
      fromBankName: bankMap.get(fromId) ?? fromId,
      toBankName: bankMap.get(toId) ?? toId,
    };
  });

  return {
    rows: mapped,
    meta: { total, page, pageSize },
  };
}

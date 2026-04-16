import { Types } from "mongoose";
import type { z } from "zod";
import { generateExcelBuffer } from "../../shared/services/excel.service";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { BankModel } from "../bank/bank.model";
import { recomputeExchangeCurrentBalance } from "../exchange/exchange.service";
import { PlayerModel } from "../player/player.model";
import { REASON_TYPES } from "../../shared/constants/reasonTypes";
import { composeRejectReasonText, loadActiveReasonForReject } from "../reason/reasonLookup.service";
import { DepositModel, DepositStatus } from "./deposit.model";
import { listDepositQuerySchema } from "./deposit.validation";

type ListDepositQuery = z.infer<typeof listDepositQuerySchema>;

function pageSizeFromQuery(q: ListDepositQuery): number {
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

function buildDepositListFilter(q: ListDepositQuery): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  const search = trimUndef(q.search);
  if (search) {
    const esc = escapeRegex(search);
    conditions.push({
      $or: [
        { utr: { $regex: esc, $options: "i" } },
        { bankName: { $regex: esc, $options: "i" } },
      ],
    });
  }

  let statusFilter = trimUndef(q.status);
  /** `all` = no status constraint (banker/exchange). Missing/empty still defaults to pending below. */
  const statusShowAll = statusFilter === "all";
  if (!statusShowAll && statusFilter == null && (q.view === "banker" || q.view === "exchange")) {
    statusFilter = "pending";
  }
  if (
    !statusShowAll &&
    (statusFilter === "pending" ||
      statusFilter === "verified" ||
      statusFilter === "rejected" ||
      statusFilter === "finalized")
  ) {
    conditions.push({ status: statusFilter });
  }

  const utr = trimUndef(q.utr);
  if (utr) {
    conditions.push(textFieldCondition("utr", utr, trimUndef(q.utr_op)));
  }

  const bankName = trimUndef(q.bankName);
  if (bankName) {
    conditions.push(textFieldCondition("bankName", bankName, trimUndef(q.bankName_op)));
  }

  const bankId = trimUndef(q.bankId);
  if (bankId && Types.ObjectId.isValid(bankId)) {
    conditions.push({ bankId: new Types.ObjectId(bankId) });
  }

  const player = trimUndef(q.player);
  if (player && Types.ObjectId.isValid(player)) {
    conditions.push({ player: new Types.ObjectId(player) });
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

  const amt = numberFieldCondition(
    "amount",
    trimUndef(q.amount),
    trimUndef(q.amount_op),
    trimUndef(q.amount_to),
  );
  if (amt) {
    conditions.push(amt);
  }

  const tot = numberFieldCondition(
    "totalAmount",
    trimUndef(q.totalAmount),
    trimUndef(q.totalAmount_op),
    trimUndef(q.totalAmount_to),
  );
  if (tot) {
    conditions.push(tot);
  }

  if (conditions.length === 0) {
    return {};
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return { $and: conditions };
}

function bankDisplayName(b: { holderName: string; bankName: string; accountNumber: string }): string {
  const last4 = b.accountNumber.length >= 4 ? b.accountNumber.slice(-4) : b.accountNumber;
  return `${b.holderName} - ${b.bankName} - ${last4}`;
}

/** UTR must be unique among non-rejected deposits; rejected rows do not block reuse. */
async function utrConflictsWithNonRejected(utr: string, excludeId?: Types.ObjectId) {
  const trimmed = utr.trim();
  const filter: { utr: string; status: { $ne: string }; _id?: { $ne: Types.ObjectId } } = {
    utr: trimmed,
    status: { $ne: "rejected" },
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  return DepositModel.findOne(filter);
}

export async function createDeposit(
  input: { bankId: string; utr: string; amount: number },
  actorId: string,
  requestId?: string,
) {
  const exists = await utrConflictsWithNonRejected(input.utr);
  if (exists) throw new AppError("business_rule_error", "UTR already exists", 409);

  const bank = await BankModel.findById(input.bankId);
  if (!bank) throw new AppError("not_found", "Bank not found", 404);
  if (bank.status !== "active") throw new AppError("business_rule_error", "Bank is not active", 400);

  const doc = await DepositModel.create({
    bankId: new Types.ObjectId(input.bankId),
    bankName: bankDisplayName(bank),
    utr: input.utr.trim(),
    amount: input.amount,
    status: "pending",
    createdBy: new Types.ObjectId(actorId),
  });

  await createAuditLog({
    actorId,
    action: "deposit.create",
    entity: "deposit",
    entityId: doc._id.toString(),
    newValue: {
      bankId: input.bankId,
      utr: input.utr,
      amount: input.amount,
    } as unknown as Record<string, unknown>,
    requestId,
  });
  return doc;
}

export async function updateDepositByBanker(
  id: string,
  input: { bankId: string; utr: string; amount: number },
  actorId: string,
  requestId?: string,
) {
  const doc = await DepositModel.findById(id);
  if (!doc) throw new AppError("not_found", "Deposit not found", 404);
  if (doc.status !== "pending") {
    throw new AppError("business_rule_error", "Only pending deposits can be updated", 400);
  }

  const utrTrim = input.utr.trim();
  if (utrTrim !== doc.utr) {
    const exists = await utrConflictsWithNonRejected(utrTrim, doc._id);
    if (exists) throw new AppError("business_rule_error", "UTR already exists", 409);
  }

  const bank = await BankModel.findById(input.bankId);
  if (!bank) throw new AppError("not_found", "Bank not found", 404);
  if (bank.status !== "active") throw new AppError("business_rule_error", "Bank is not active", 400);

  const prev = {
    bankId: doc.bankId?.toString(),
    bankName: doc.bankName,
    utr: doc.utr,
    amount: doc.amount,
  };

  doc.bankId = new Types.ObjectId(input.bankId);
  doc.bankName = bankDisplayName(bank);
  doc.utr = utrTrim;
  doc.amount = input.amount;
  await doc.save();

  await createAuditLog({
    actorId,
    action: "deposit.banker_update",
    entity: "deposit",
    entityId: doc._id.toString(),
    oldValue: prev as unknown as Record<string, unknown>,
    newValue: {
      bankId: input.bankId,
      utr: utrTrim,
      amount: input.amount,
    } as unknown as Record<string, unknown>,
    requestId,
  });

  return doc;
}

export type LastBankerDepositMeta = { bankId: string; bankName: string } | null;

async function lastBankerDepositForActor(
  view: ListDepositQuery["view"],
  actorId: string | undefined,
): Promise<LastBankerDepositMeta> {
  if (view !== "banker" || !actorId || !Types.ObjectId.isValid(actorId)) return null;
  const row = await DepositModel.findOne({ createdBy: new Types.ObjectId(actorId) })
    .sort({ createdAt: -1 })
    .select({ bankId: 1, bankName: 1 })
    .lean();
  if (!row) return null;
  const raw = row.bankId as unknown;
  const bankId =
    raw != null && typeof raw === "object" && "_id" in (raw as object)
      ? String((raw as { _id?: unknown })._id)
      : raw != null
        ? String(raw)
        : "";
  if (!bankId) return null;
  const bankName = typeof row.bankName === "string" ? row.bankName.trim() : "";
  return { bankId, bankName: bankName || "—" };
}

export async function listDeposits(query: ListDepositQuery, options?: { actorId?: string }) {
  const filter = buildDepositListFilter(query);
  const page = query.page;
  const pageSize = pageSizeFromQuery(query);
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;
  const sortField = query.sortBy;

  const [rows, total, lastBankerDeposit] = await Promise.all([
    DepositModel.find(filter)
      .populate("bankId", "holderName bankName accountNumber ifsc openingBalance currentBalance")
      .populate("player", "playerId phone exchange")
      .populate("createdBy", "fullName username")
      .populate("exchangeActionBy", "fullName username")
      .sort({ [sortField]: sortValue })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    DepositModel.countDocuments(filter),
    lastBankerDepositForActor(query.view, options?.actorId),
  ]);

  const meta: {
    page: number;
    pageSize: number;
    total: number;
    lastBankerDeposit?: LastBankerDepositMeta;
  } = {
    page,
    pageSize,
    total,
  };
  if (query.view === "banker") {
    meta.lastBankerDeposit = lastBankerDeposit;
  }

  return {
    rows,
    meta,
  };
}

const EXPORT_MAX_ROWS = 10_000;

function formatUserForExport(u: unknown): string {
  if (u == null) return "";
  if (typeof u === "object" && u !== null && "_id" in u) {
    const x = u as { fullName?: string; username?: string };
    const fn = x.fullName?.trim();
    const un = x.username?.trim();
    if (fn && un) return `${fn} (${un})`;
    if (fn) return fn;
    if (un) return un;
  }
  return "";
}

export async function exportDepositsToBuffer(query: ListDepositQuery): Promise<Buffer> {
  const filter = buildDepositListFilter(query);
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const rows = await DepositModel.find(filter)
    .populate("bankId", "holderName bankName accountNumber")
    .populate("player", "playerId")
    .sort({ [query.sortBy]: sortValue })
    .limit(EXPORT_MAX_ROWS)
    .lean();

  return generateExcelBuffer(rows, [
    { header: "UTR", key: "utr" },
    { header: "Bank label", key: "bankName" },
    { header: "Amount", key: "amount" },
    { header: "Status", key: "status" },
    { header: "Bonus amount", key: "bonusAmount" },
    { header: "Total amount", key: "totalAmount" },
    { header: "Reject reason", key: "rejectReason" },
    { header: "Bank balance after", key: "bankBalanceAfter" },
    { header: "Settled at", transform: (r) => (r.settledAt ? new Date(r.settledAt).toISOString() : "") },
    { header: "Created at", transform: (r) => (r.createdAt ? new Date(r.createdAt).toISOString() : "") },
  ], "Deposits");
}

function bonusAmountFromPercent(amount: number, percent: number): number {
  return Math.round(((amount * percent) / 100) * 100) / 100;
}

async function isFirstDepositForPlayer(playerId: Types.ObjectId, currentDepositId: Types.ObjectId): Promise<boolean> {
  const prior = await DepositModel.exists({
    _id: { $ne: currentDepositId },
    player: playerId,
    status: { $ne: "rejected" },
  });
  return prior == null;
}

export async function exchangeApproveDeposit(
  id: string,
  input: { playerId: string; bonusAmount: number },
  actorId: string,
  requestId?: string,
) {
  const requestedBonus = Number(input.bonusAmount);
  if (!Number.isFinite(requestedBonus) || requestedBonus < 0) {
    throw new AppError("validation_error", "Invalid bonus amount", 400);
  }

  const doc = await DepositModel.findById(id);
  if (!doc) throw new AppError("not_found", "Deposit not found", 404);
  if (doc.status !== "pending") {
    throw new AppError("business_rule_error", "Deposit is not pending exchange action", 400);
  }
  if (!doc.bankId) {
    throw new AppError("business_rule_error", "Deposit has no bank linked", 400);
  }

  const playerDoc = await PlayerModel.findById(input.playerId).select(
    "regularBonusPercentage firstDepositBonusPercentage exchange",
  );
  if (!playerDoc) throw new AppError("not_found", "Player not found", 404);
  if (!playerDoc.exchange) {
    throw new AppError("business_rule_error", "Player has no exchange assigned", 400);
  }

  const playerObjectId = new Types.ObjectId(input.playerId);
  const isFirstDeposit = await isFirstDepositForPlayer(playerObjectId, doc._id);
  const appliedBonusPercent = isFirstDeposit
    ? playerDoc.firstDepositBonusPercentage
    : playerDoc.regularBonusPercentage;
  const bonusFromRule = bonusAmountFromPercent(doc.amount, appliedBonusPercent);
  const bonus = Math.round(requestedBonus * 100) / 100;
  const totalAmount = doc.amount + bonus;
  const bankCashCredit = doc.amount;
  const bank = await BankModel.findById(doc.bankId);
  if (!bank) throw new AppError("not_found", "Bank not found", 404);

  const prev = bank.currentBalance ?? bank.openingBalance;
  const bankBalanceAfter = prev + bankCashCredit;

  bank.currentBalance = bankBalanceAfter;
  await bank.save();

  try {
    doc.status = "verified" as DepositStatus;
    doc.player = playerObjectId;
    doc.bonusAmount = bonus;
    doc.totalAmount = totalAmount;
    doc.exchangeActionBy = new Types.ObjectId(actorId);
    doc.exchangeActionAt = new Date();
    doc.bankBalanceAfter = bankBalanceAfter;
    doc.settledAt = new Date();
    await doc.save();
  } catch (err) {
    bank.currentBalance = prev;
    await bank.save();
    throw err;
  }

  await createAuditLog({
    actorId,
    action: "deposit.exchange_approve",
    entity: "deposit",
    entityId: doc._id.toString(),
    newValue: {
      playerId: input.playerId,
      bonusAmount: bonus,
      requestedBonusAmount: requestedBonus,
      bonusFromRule,
      appliedBonusPercent,
      appliedBonusType: isFirstDeposit ? "first_deposit" : "regular",
      totalAmount,
      bankCashCredit,
      bankBalanceAfter,
    },
    requestId,
  });

  await recomputeExchangeCurrentBalance(String(playerDoc.exchange));

  return doc;
}

export async function exchangeRejectDeposit(
  id: string,
  input: { reasonId: string; remark?: string },
  actorId: string,
  requestId?: string,
) {
  const resolved = await loadActiveReasonForReject(input.reasonId, REASON_TYPES.DEPOSIT_EXCHANGE_REJECT);
  const rejectText = composeRejectReasonText(resolved.masterText, input.remark);

  const doc = await DepositModel.findById(id);
  if (!doc) throw new AppError("not_found", "Deposit not found", 404);
  if (doc.status !== "pending") {
    throw new AppError("business_rule_error", "Deposit is not pending exchange action", 400);
  }

  doc.status = "rejected";
  doc.rejectReason = rejectText;
  doc.rejectReasonId = new Types.ObjectId(resolved.id);
  doc.exchangeActionBy = new Types.ObjectId(actorId);
  doc.exchangeActionAt = new Date();
  await doc.save();

  await createAuditLog({
    actorId,
    action: "deposit.exchange_reject",
    entity: "deposit",
    entityId: doc._id.toString(),
    newValue: {
      rejectReason: rejectText,
      rejectReasonId: resolved.id,
      remark: input.remark?.trim() || undefined,
    },
    requestId,
  });
  return doc;
}

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
import {
  DEFAULT_TIMEZONE,
  formatDateTimeForTimeZone,
  ymdToUtcEnd,
  ymdToUtcStart,
} from "../../shared/utils/timezone";
import type { DepositAmendmentSnapshot } from "./deposit.model";
import { DepositModel, DepositStatus } from "./deposit.model";
import { amendDepositBodySchema, listDepositQuerySchema } from "./deposit.validation";
import { emitApprovalQueueEvent } from "../approval/approval-queue-events";

type ListDepositQuery = z.infer<typeof listDepositQuerySchema>;
type AmendDepositInput = z.infer<typeof amendDepositBodySchema>;

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

function parseBusinessDateTime(value: string | undefined, fieldName: string): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError("validation_error", `${fieldName} must be a valid datetime`, 400);
  }
  return parsed;
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

function transactionDateCondition(
  from: string | undefined,
  to: string | undefined,
  op: string | undefined,
  timeZone: string,
): Record<string, unknown> | null {
  const txExpr = { $ifNull: ["$entryAt", "$createdAt"] };
  const operator = op || "inRange";
  const f = trimUndef(from);
  const t = trimUndef(to);

  if (operator === "inRange" && f && t) {
    const start = ymdToUtcStart(f, timeZone);
    const end = ymdToUtcEnd(t, timeZone);
    if (!start || !end) return null;
    return { $expr: { $and: [{ $gte: [txExpr, start] }, { $lte: [txExpr, end] }] } };
  }
  if (operator === "equals" && f) {
    const start = ymdToUtcStart(f, timeZone);
    const end = ymdToUtcEnd(f, timeZone);
    if (!start || !end) return null;
    return { $expr: { $and: [{ $gte: [txExpr, start] }, { $lte: [txExpr, end] }] } };
  }
  if (operator === "before" && f) {
    const start = ymdToUtcStart(f, timeZone);
    if (!start) return null;
    return { $expr: { $lt: [txExpr, start] } };
  }
  if (operator === "after" && f) {
    const end = ymdToUtcEnd(f, timeZone);
    if (!end) return null;
    return { $expr: { $gt: [txExpr, end] } };
  }
  if (f && t) {
    const start = ymdToUtcStart(f, timeZone);
    const end = ymdToUtcEnd(t, timeZone);
    if (!start || !end) return null;
    return { $expr: { $and: [{ $gte: [txExpr, start] }, { $lte: [txExpr, end] }] } };
  }
  if (f) {
    const start = ymdToUtcStart(f, timeZone);
    if (!start) return null;
    return { $expr: { $gte: [txExpr, start] } };
  }
  if (t) {
    const end = ymdToUtcEnd(t, timeZone);
    if (!end) return null;
    return { $expr: { $lte: [txExpr, end] } };
  }
  return null;
}

function buildDepositListFilter(q: ListDepositQuery, timeZone: string): Record<string, unknown> {
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
      statusFilter === "not_settled" ||
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

  const dateCond = transactionDateCondition(
    trimUndef(q.createdAt_from),
    trimUndef(q.createdAt_to),
    trimUndef(q.createdAt_op),
    timeZone,
  );
  if (dateCond) {
    conditions.push(dateCond);
  }

  const hasAmendment = trimUndef(q.hasAmendment);
  if (hasAmendment === "yes") {
    conditions.push({
      $or: [{ amendmentCount: { $gt: 0 } }, { "amendmentHistory.0": { $exists: true } }],
    });
  } else if (hasAmendment === "no") {
    conditions.push({
      $nor: [{ amendmentCount: { $gt: 0 } }, { "amendmentHistory.0": { $exists: true } }],
    });
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
  input: { bankId: string; utr: string; amount: number; entryAt?: string },
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
    entryAt: parseBusinessDateTime(input.entryAt, "entryAt"),
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
      entryAt: doc.entryAt,
    } as unknown as Record<string, unknown>,
    requestId,
  });
  emitApprovalQueueEvent("deposit", "exchange");
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

  emitApprovalQueueEvent("deposit", "exchange");
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

export async function listDeposits(
  query: ListDepositQuery,
  options?: { actorId?: string; timeZone?: string },
) {
  const timeZone = options?.timeZone || DEFAULT_TIMEZONE;
  const filter = buildDepositListFilter(query, timeZone);
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
      .populate("lastAmendedBy", "fullName username")
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

export async function exportDepositsToBuffer(
  query: ListDepositQuery,
  options?: { timeZone?: string },
): Promise<Buffer> {
  const timeZone = options?.timeZone || DEFAULT_TIMEZONE;
  const filter = buildDepositListFilter(query, timeZone);
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
    { header: "Amount", transform: (r) => Math.round(Number(r.amount ?? 0)) },
    { header: "Status", key: "status" },
    { header: "Bonus amount", transform: (r) => Math.round(Number(r.bonusAmount ?? 0)) },
    { header: "Total amount", transform: (r) => Math.round(Number(r.totalAmount ?? 0)) },
    { header: "Amendment count", key: "amendmentCount" },
    {
      header: "Last amended at",
      transform: (r) => formatDateTimeForTimeZone(r.lastAmendedAt, timeZone),
    },
    { header: "Reject reason", key: "rejectReason" },
    { header: "Bank balance after", transform: (r) => Math.round(Number(r.bankBalanceAfter ?? 0)) },
    { header: "Settled at", transform: (r) => formatDateTimeForTimeZone(r.settledAt, timeZone) },
    {
      header: "Transaction at",
      transform: (r) => formatDateTimeForTimeZone(r.entryAt ?? r.createdAt, timeZone),
    },
  ], "Deposits");
}

async function recomputeExchangesForDepositPlayers(doc: {
  player?: Types.ObjectId;
  amendmentHistory?: Array<{
    old?: { playerId?: string };
    new?: { playerId?: string };
  }>;
}) {
  const playerIds = new Set<string>();
  if (doc.player && Types.ObjectId.isValid(String(doc.player))) {
    playerIds.add(String(doc.player));
  }
  for (const entry of doc.amendmentHistory ?? []) {
    const oldPlayerId = entry.old?.playerId;
    const newPlayerId = entry.new?.playerId;
    if (oldPlayerId && Types.ObjectId.isValid(oldPlayerId)) playerIds.add(oldPlayerId);
    if (newPlayerId && Types.ObjectId.isValid(newPlayerId)) playerIds.add(newPlayerId);
  }
  if (playerIds.size === 0) return;

  const rows = await PlayerModel.find({ _id: { $in: [...playerIds].map((id) => new Types.ObjectId(id)) } })
    .select("exchange")
    .lean();
  const exchangeIds = new Set<string>();
  for (const row of rows) {
    if (row.exchange) {
      exchangeIds.add(String(row.exchange));
    }
  }
  for (const exchangeId of exchangeIds) {
    await recomputeExchangeCurrentBalance(exchangeId);
  }
}

export async function deleteDepositWithReversal(id: string, actorId: string, requestId?: string) {
  const doc = await DepositModel.findById(id);
  if (!doc) throw new AppError("not_found", "Deposit not found", 404);

  const oldValue = {
    bankId: doc.bankId?.toString(),
    bankName: doc.bankName,
    utr: doc.utr,
    amount: doc.amount,
    status: doc.status,
    playerId: doc.player?.toString(),
    bonusAmount: doc.bonusAmount,
    totalAmount: doc.totalAmount,
    entryAt: doc.entryAt,
    settledAt: doc.settledAt,
    amendmentCount: doc.amendmentCount,
    amendmentHistory: doc.amendmentHistory ?? [],
    createdAt: doc.createdAt,
  };

  const shouldReverseBank =
    (doc.status === "verified" || doc.status === "finalized") &&
    !!doc.bankId &&
    Number.isFinite(Number(doc.amount));

  let bankReversalMeta: { bankId?: string; previousBalance?: number; nextBalance?: number; delta?: number } = {};
  let rollbackBank: (() => Promise<void>) | null = null;

  if (shouldReverseBank) {
    const bank = await BankModel.findById(doc.bankId);
    if (!bank) throw new AppError("not_found", "Bank not found", 404);
    const prev = bank.currentBalance ?? bank.openingBalance;
    const delta = Number(doc.amount ?? 0);
    const next = prev - delta;
    bank.currentBalance = next;
    await bank.save();
    bankReversalMeta = {
      bankId: String(bank._id),
      previousBalance: prev,
      nextBalance: next,
      delta: -delta,
    };
    rollbackBank = async () => {
      bank.currentBalance = prev;
      await bank.save();
    };
  }

  try {
    await DepositModel.deleteOne({ _id: doc._id });
  } catch (error) {
    if (rollbackBank) await rollbackBank();
    throw error;
  }

  await recomputeExchangesForDepositPlayers({
    player: doc.player,
    amendmentHistory: doc.amendmentHistory as Array<{ old?: { playerId?: string }; new?: { playerId?: string } }>,
  });

  await createAuditLog({
    actorId,
    action: "deposit.delete",
    entity: "deposit",
    entityId: String(doc._id),
    oldValue: oldValue as unknown as Record<string, unknown>,
    newValue: {
      deleted: true,
      reversal: {
        status: doc.status,
        bank: bankReversalMeta,
      },
    },
    requestId,
  });

  return { id: String(doc._id), deleted: true };
}

function bonusAmountFromPercent(amount: number, percent: number): number {
  return Math.round((amount * percent) / 100);
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
  if (doc.status !== "pending" && doc.status !== "not_settled") {
    throw new AppError("business_rule_error", "Deposit is not pending/not-settled exchange action", 400);
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
  const bonus = Math.round(requestedBonus);
  const totalAmount = Math.round(Number(doc.amount) + bonus);
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

export async function exchangeMarkNotSettled(id: string, actorId: string, requestId?: string) {
  const doc = await DepositModel.findById(id);
  if (!doc) throw new AppError("not_found", "Deposit not found", 404);
  if (doc.status !== "pending") {
    throw new AppError("business_rule_error", "Only pending deposits can be marked not settled", 400);
  }

  doc.status = "not_settled";
  doc.exchangeActionBy = new Types.ObjectId(actorId);
  doc.exchangeActionAt = new Date();
  doc.player = undefined;
  doc.bonusAmount = undefined;
  doc.totalAmount = undefined;
  doc.bankBalanceAfter = undefined;
  doc.settledAt = undefined;
  doc.rejectReason = undefined;
  doc.rejectReasonId = undefined;
  await doc.save();

  await createAuditLog({
    actorId,
    action: "deposit.exchange_mark_not_settled",
    entity: "deposit",
    entityId: doc._id.toString(),
    newValue: {
      status: "not_settled",
    },
    requestId,
  });

  emitApprovalQueueEvent("deposit", "exchange");
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
  if (doc.status !== "pending" && doc.status !== "not_settled") {
    throw new AppError("business_rule_error", "Deposit is not pending/not-settled exchange action", 400);
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

/**
 * In-place amendment for settled (`verified`) deposits. Updates bank cash balance delta,
 * exchange recomputation for affected players, and appends `amendmentHistory`.
 */
export async function amendVerifiedDeposit(
  id: string,
  input: AmendDepositInput,
  actorId: string,
  requestId?: string,
) {
  const doc = await DepositModel.findById(id);
  if (!doc) throw new AppError("not_found", "Deposit not found", 404);
  if (doc.status !== "verified") {
    throw new AppError("business_rule_error", "Only verified deposits can be amended", 400);
  }
  if (!doc.bankId || !doc.player) {
    throw new AppError("business_rule_error", "Deposit is missing bank or player", 400);
  }

  const utrTrim = input.utr.trim();
  if (utrTrim !== doc.utr) {
    const exists = await utrConflictsWithNonRejected(utrTrim, doc._id);
    if (exists) throw new AppError("business_rule_error", "UTR already exists", 409);
  }

  const newBankDoc = await BankModel.findById(input.bankId);
  if (!newBankDoc) throw new AppError("not_found", "Bank not found", 404);
  if (newBankDoc.status !== "active") throw new AppError("business_rule_error", "Bank is not active", 400);

  const newPlayerDoc = await PlayerModel.findById(input.playerId).select("exchange");
  if (!newPlayerDoc) throw new AppError("not_found", "Player not found", 404);
  if (!newPlayerDoc.exchange) {
    throw new AppError("business_rule_error", "Player has no exchange assigned", 400);
  }

  const bonus = Math.round(Number(input.bonusAmount));
  const totalAmount = Math.round(Number(input.amount) + bonus);
  const nextEntryAt = input.entryAt ? parseBusinessDateTime(input.entryAt, "entryAt") : doc.entryAt;
  const resolved = await loadActiveReasonForReject(input.reasonId, REASON_TYPES.DEPOSIT_FINAL_AMEND);
  const amendReasonText = composeRejectReasonText(resolved.masterText, input.remark);

  const oldBankId = doc.bankId;
  const oldAmount = doc.amount;
  const newBankId = new Types.ObjectId(input.bankId);
  const newAmount = input.amount;

  const oldSnapshot: DepositAmendmentSnapshot = {
    bankId: doc.bankId?.toString(),
    bankName: doc.bankName,
    utr: doc.utr,
    amount: doc.amount,
    playerId: doc.player?.toString(),
    bonusAmount: doc.bonusAmount,
    totalAmount: doc.totalAmount,
  };
  const oldEntryAt = doc.entryAt;

  const newSnapshotPlain: DepositAmendmentSnapshot = {
    bankId: input.bankId,
    bankName: bankDisplayName(newBankDoc),
    utr: utrTrim,
    amount: input.amount,
    playerId: input.playerId,
    bonusAmount: bonus,
    totalAmount,
  };

  let newBankBalanceAfter: number;
  let rollbackBanks: (() => Promise<void>) | undefined;

  if (String(oldBankId) === String(newBankId)) {
    const bank = await BankModel.findById(oldBankId);
    if (!bank) throw new AppError("not_found", "Bank not found", 404);
    const prevBal = bank.currentBalance ?? bank.openingBalance;
    const delta = newAmount - oldAmount;
    const nextBal = prevBal + delta;
    bank.currentBalance = nextBal;
    await bank.save();
    newBankBalanceAfter = nextBal;
    rollbackBanks = async () => {
      bank.currentBalance = prevBal;
      await bank.save();
    };
  } else {
    const oldBank = await BankModel.findById(oldBankId);
    if (!oldBank) throw new AppError("not_found", "Bank not found", 404);
    const prevOld = oldBank.currentBalance ?? oldBank.openingBalance;
    oldBank.currentBalance = prevOld - oldAmount;
    await oldBank.save();

    const creditBank = await BankModel.findById(newBankId);
    if (!creditBank) {
      oldBank.currentBalance = prevOld;
      await oldBank.save();
      throw new AppError("not_found", "Bank not found", 404);
    }
    const prevNew = creditBank.currentBalance ?? creditBank.openingBalance;
    creditBank.currentBalance = prevNew + newAmount;
    try {
      await creditBank.save();
    } catch (err) {
      oldBank.currentBalance = prevOld;
      await oldBank.save();
      throw err;
    }
    newBankBalanceAfter = creditBank.currentBalance ?? creditBank.openingBalance;

    rollbackBanks = async () => {
      oldBank.currentBalance = prevOld;
      await oldBank.save();
      creditBank.currentBalance = prevNew;
      await creditBank.save();
    };
  }

  const oldPlayerId = doc.player;

  try {
    doc.bankId = newBankId;
    doc.bankName = newSnapshotPlain.bankName ?? doc.bankName;
    doc.utr = utrTrim;
    doc.amount = input.amount;
    doc.player = new Types.ObjectId(input.playerId);
    doc.bonusAmount = bonus;
    doc.totalAmount = totalAmount;
    doc.entryAt = nextEntryAt;
    doc.bankBalanceAfter = newBankBalanceAfter;
    doc.amendmentCount = (doc.amendmentCount ?? 0) + 1;
    doc.lastAmendedAt = new Date();
    doc.lastAmendedBy = new Types.ObjectId(actorId);
    const history = doc.amendmentHistory ?? [];
    history.push({
      at: new Date(),
      by: new Types.ObjectId(actorId),
      reason: amendReasonText,
      old: oldSnapshot,
      new: newSnapshotPlain,
    });
    doc.amendmentHistory = history;
    await doc.save();
  } catch (err) {
    if (rollbackBanks) await rollbackBanks();
    throw err;
  }

  const oldPlayer = await PlayerModel.findById(oldPlayerId).select("exchange");
  const exchanges = new Set<string>();
  if (oldPlayer?.exchange) exchanges.add(String(oldPlayer.exchange));
  if (newPlayerDoc.exchange) exchanges.add(String(newPlayerDoc.exchange));
  for (const ex of exchanges) {
    await recomputeExchangeCurrentBalance(ex);
  }

  await createAuditLog({
    actorId,
    action: "deposit.amend",
    entity: "deposit",
    entityId: doc._id.toString(),
    oldValue: { ...oldSnapshot, entryAt: oldEntryAt } as unknown as Record<string, unknown>,
    newValue: {
      ...newSnapshotPlain,
      entryAt: nextEntryAt,
      reason: amendReasonText,
      reasonId: resolved.id,
      remark: input.remark?.trim() || undefined,
    } as unknown as Record<string, unknown>,
    requestId,
  });

  return doc;
}

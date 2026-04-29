import { Types } from "mongoose";
import type { z } from "zod";
import { generateExcelBuffer } from "../../shared/services/excel.service";
import { REASON_TYPES } from "../../shared/constants/reasonTypes";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { BankModel } from "../bank/bank.model";
import { DepositModel } from "../deposit/deposit.model";
import { ExpenseModel } from "../expense/expense.model";
import { LiabilityEntryModel } from "../liability/liability-entry.model";
import { PlayerModel } from "../player/player.model";
import { composeRejectReasonText, loadActiveReasonForReject } from "../reason/reasonLookup.service";
import { AuditLogModel } from "../audit/audit.model";
import {
  DEFAULT_TIMEZONE,
  formatDateTimeForTimeZone,
  ymdToUtcEnd,
  ymdToUtcStart,
} from "../../shared/utils/timezone";
import type { WithdrawalAmendmentSnapshot } from "./withdrawal.model";
import { WithdrawalModel, WithdrawalStatus } from "./withdrawal.model";
import { amendWithdrawalBodySchema, listWithdrawalQuerySchema } from "./withdrawal.validation";
import { emitApprovalQueueEvent } from "../approval/approval-queue-events";
import { decodeTimeCursor, encodeTimeCursor } from "../../shared/utils/cursorPagination";
import { enqueueExchangeRecompute } from "../../shared/queue/queue";
import { invalidateCacheDomains } from "../../shared/cache/domainCache";
import { logger } from "../../shared/logger";
import { escapeRegex as escapeUtrRegex, normalizeUtr } from "../../shared/utils/utr";

type ListWithdrawalQuery = z.infer<typeof listWithdrawalQuerySchema>;
type AmendWithdrawalInput = z.infer<typeof amendWithdrawalBodySchema>;
type DuplicateTransactionContext = {
  type: "deposit" | "withdrawal";
  id: string;
  status: string;
  dateTime: Date;
};

function pageSizeFromQuery(q: ListWithdrawalQuery): number {
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

async function utrConflictsWithNonRejectedDeposit(utr: string) {
  const normalized = normalizeUtr(utr);
  return DepositModel.findOne({
    utr: { $regex: `^${escapeUtrRegex(normalized)}$`, $options: "i" },
    status: { $ne: "rejected" },
  })
    .select({ _id: 1, status: 1, entryAt: 1, createdAt: 1 })
    .lean();
}

async function utrConflictsWithNonRejectedWithdrawal(utr: string, excludeId?: Types.ObjectId) {
  const normalized = normalizeUtr(utr);
  const filter: { utr: { $regex: string; $options: string }; status: { $ne: string }; _id?: { $ne: Types.ObjectId } } = {
    utr: { $regex: `^${escapeUtrRegex(normalized)}$`, $options: "i" },
    status: { $ne: "rejected" },
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  return WithdrawalModel.findOne(filter).select({ _id: 1, status: 1, requestedAt: 1, createdAt: 1 }).lean();
}

async function ensureGlobalUtrUniqueForWithdrawal(utr: string, excludeWithdrawalId?: Types.ObjectId) {
  const [depositConflict, withdrawalConflict] = await Promise.all([
    utrConflictsWithNonRejectedDeposit(utr),
    utrConflictsWithNonRejectedWithdrawal(utr, excludeWithdrawalId),
  ]);
  if (depositConflict || withdrawalConflict) {
    const duplicateTransaction: DuplicateTransactionContext | null = depositConflict
      ? {
          type: "deposit",
          id: String(depositConflict._id),
          status: String(depositConflict.status ?? ""),
          dateTime: (depositConflict.entryAt as Date | undefined) ?? (depositConflict.createdAt as Date),
        }
      : withdrawalConflict
        ? {
            type: "withdrawal",
            id: String(withdrawalConflict._id),
            status: String(withdrawalConflict.status ?? ""),
            dateTime: (withdrawalConflict.requestedAt as Date | undefined) ?? (withdrawalConflict.createdAt as Date),
          }
        : null;
    throw new AppError("business_rule_error", "UTR already exists in another transaction", 409, {
      duplicateTransaction,
    });
  }
}

function textFieldCondition(field: string, value: string, op: string | undefined): Record<string, unknown> {
  const operator = op || "contains";
  const esc = escapeRegex(value);
  switch (operator) {
    case "contains":
      return { [field]: { $regex: esc, $options: "i" } };
    case "equals":
      return { [field]: { $regex: `^${esc}$`, $options: "i" } };
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
  const txExpr = { $ifNull: ["$requestedAt", "$createdAt"] };
  const f = trimUndef(from);
  const t = trimUndef(to);
  const operator = op || "inRange";
  if (operator === "inRange" && f && t) {
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

function bankDisplayName(b: { holderName: string; bankName: string; accountNumber: string }): string {
  const last4 = b.accountNumber.length >= 4 ? b.accountNumber.slice(-4) : b.accountNumber;
  return `${b.holderName} - ${b.bankName} - ${last4}`;
}

/** Base filters per list view (deposit-style `view` query). */
function viewBaseCondition(view: ListWithdrawalQuery["view"]): Record<string, unknown> {
  switch (view) {
    case "banker":
      return {
        status: "requested",
        $or: [{ utr: { $exists: false } }, { utr: null }, { utr: "" }],
      };
    case "exchange":
      return { status: { $in: ["requested", "approved", "rejected"] as const } };
    case "final":
    default:
      return {};
  }
}

function buildWithdrawalListFilter(q: ListWithdrawalQuery, timeZone: string): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [viewBaseCondition(q.view)];

  const search = trimUndef(q.search);
  if (search) {
    const esc = escapeRegex(search);
    conditions.push({
      $or: [
        { utr: { $regex: esc, $options: "i" } },
        { bankName: { $regex: esc, $options: "i" } },
        { playerName: { $regex: esc, $options: "i" } },
        { accountNumber: { $regex: esc, $options: "i" } },
      ],
    });
  }

  const statusFilter = trimUndef(q.status);
  if (statusFilter && statusFilter !== "all") {
    if (
      statusFilter === "requested" ||
      statusFilter === "approved" ||
      statusFilter === "rejected" ||
      statusFilter === "finalized"
    ) {
      conditions.push({ status: statusFilter });
    }
  }

  const utr = trimUndef(q.utr);
  if (utr) {
    conditions.push(textFieldCondition("utr", utr, trimUndef(q.utr_op)));
  }

  const bankName = trimUndef(q.bankName);
  if (bankName) {
    conditions.push(textFieldCondition("bankName", bankName, trimUndef(q.bankName_op)));
  }

  const playerName = trimUndef(q.playerName);
  if (playerName) {
    conditions.push(textFieldCondition("playerName", playerName, trimUndef(q.playerName_op)));
  }

  const amountCond = numberFieldCondition("amount", trimUndef(q.amount), trimUndef(q.amount_op), trimUndef(q.amount_to));
  if (amountCond) conditions.push(amountCond);

  const payableCond = numberFieldCondition(
    "payableAmount",
    trimUndef(q.payableAmount),
    trimUndef(q.payableAmount_op),
    trimUndef(q.payableAmount_to),
  );
  if (payableCond) conditions.push(payableCond);

  const dateCond = transactionDateCondition(
    trimUndef(q.createdAt_from),
    trimUndef(q.createdAt_to),
    trimUndef(q.createdAt_op),
    timeZone,
  );
  if (dateCond) conditions.push(dateCond);

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

  if (conditions.length === 0) {
    return {};
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return { $and: conditions };
}

function payableFromAmounts(amount: number, reverseBonus: number): number {
  const raw = amount - reverseBonus;
  return Math.max(0, Math.round(raw));
}

async function computeClosingBalanceActualByBankIds(bankIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (bankIds.length === 0) return new Map();
  const [banks, deposits, withdrawals, expenses, liabilities] = await Promise.all([
    BankModel.find({ _id: { $in: bankIds } })
      .select({ _id: 1, openingBalance: 1 })
      .lean(),
    DepositModel.find({ bankId: { $in: bankIds }, status: "verified" })
      .select({ bankId: 1, amount: 1 })
      .lean(),
    WithdrawalModel.find({ payoutBankId: { $in: bankIds }, status: "approved" })
      .select({ payoutBankId: 1, amount: 1, payableAmount: 1 })
      .lean(),
    ExpenseModel.find({ bankId: { $in: bankIds }, status: "approved" })
      .select({ bankId: 1, amount: 1 })
      .lean(),
    LiabilityEntryModel.find({
      $or: [
        { fromAccountType: "bank", fromAccountId: { $in: bankIds } },
        { toAccountType: "bank", toAccountId: { $in: bankIds } },
      ],
    })
      .select({ fromAccountType: 1, fromAccountId: 1, toAccountType: 1, toAccountId: 1, amount: 1 })
      .lean(),
  ]);

  const totals = new Map<string, number>();
  for (const b of banks) totals.set(String(b._id), Number(b.openingBalance ?? 0));
  for (const d of deposits) {
    const id = String(d.bankId);
    totals.set(id, (totals.get(id) ?? 0) + Number(d.amount ?? 0));
  }
  for (const w of withdrawals) {
    const id = String(w.payoutBankId);
    totals.set(id, (totals.get(id) ?? 0) - Number(w.payableAmount ?? w.amount ?? 0));
  }
  for (const e of expenses) {
    const id = String(e.bankId);
    totals.set(id, (totals.get(id) ?? 0) - Number(e.amount ?? 0));
  }
  for (const le of liabilities) {
    const amt = Number(le.amount ?? 0);
    if (le.fromAccountType === "bank" && le.fromAccountId) {
      const id = String(le.fromAccountId);
      totals.set(id, (totals.get(id) ?? 0) - amt);
    }
    if (le.toAccountType === "bank" && le.toAccountId) {
      const id = String(le.toAccountId);
      totals.set(id, (totals.get(id) ?? 0) + amt);
    }
  }
  return totals;
}

async function normalizeBankCurrentBalances(bankIds: string[]) {
  const unique = [...new Set(bankIds.filter((id) => Types.ObjectId.isValid(id)))];
  if (unique.length === 0) return;
  const objectIds = unique.map((id) => new Types.ObjectId(id));
  const totals = await computeClosingBalanceActualByBankIds(objectIds);
  await Promise.all(
    unique.map((id) =>
      BankModel.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { currentBalance: Number(totals.get(id) ?? 0) } },
      ),
    ),
  );
}

export async function createWithdrawal(
  input: {
    playerId: string;
    accountNumber: string;
    accountHolderName: string;
    bankName: string;
    ifsc: string;
    amount: number;
    reverseBonus: number;
    requestedAt?: string;
  },
  actorId: string,
  requestId?: string,
) {
  const player = await PlayerModel.findById(input.playerId);
  if (!player) throw new AppError("not_found", "Player not found", 404);

  const reverseBonus = input.reverseBonus ?? 0;
  const payableAmount = payableFromAmounts(input.amount, reverseBonus);
  const playerLabel = `${player.playerId} · ${player.phone}`;

  const doc = await WithdrawalModel.create({
    player: new Types.ObjectId(input.playerId),
    playerName: playerLabel,
    accountNumber: input.accountNumber.trim(),
    accountHolderName: input.accountHolderName.trim(),
    bankName: input.bankName.trim(),
    ifsc: input.ifsc.trim(),
    amount: input.amount,
    reverseBonus,
    payableAmount,
    requestedAt: parseBusinessDateTime(input.requestedAt, "requestedAt"),
    status: "requested",
    createdBy: new Types.ObjectId(actorId),
  });

  await createAuditLog({
    actorId,
    action: "withdrawal.create",
    entity: "withdrawal",
    entityId: doc._id.toString(),
    newValue: {
      playerId: input.playerId,
      accountNumber: input.accountNumber,
      amount: input.amount,
      payableAmount,
      requestedAt: doc.requestedAt,
    } as unknown as Record<string, unknown>,
    requestId,
  });

  if (doc.player && Types.ObjectId.isValid(String(doc.player))) {
    const player = await PlayerModel.findById(doc.player).select("exchange").lean();
    if (player?.exchange) {
      await enqueueExchangeRecompute(String(player.exchange));
      await invalidateCacheDomains(["withdrawal", "exchange", "player"]);
    }
  }

  emitApprovalQueueEvent("withdrawal", "banker");
  return doc;
}

export async function updateWithdrawalByExchange(
  id: string,
  input: {
    accountNumber: string;
    accountHolderName: string;
    bankName: string;
    ifsc: string;
    amount: number;
    reverseBonus: number;
  },
  actorId: string,
  requestId?: string,
) {
  const doc = await WithdrawalModel.findById(id);
  if (!doc) throw new AppError("not_found", "Withdrawal not found", 404);
  if (doc.status !== "requested") {
    throw new AppError("business_rule_error", "Only requested withdrawals can be updated", 400);
  }

  const nextReverseBonus = input.reverseBonus ?? 0;
  const payableAmount = payableFromAmounts(input.amount, nextReverseBonus);
  const prev = {
    accountNumber: doc.accountNumber,
    accountHolderName: doc.accountHolderName,
    bankName: doc.bankName,
    ifsc: doc.ifsc,
    amount: doc.amount,
    reverseBonus: doc.reverseBonus,
    payableAmount: doc.payableAmount,
  };

  doc.accountNumber = input.accountNumber.trim();
  doc.accountHolderName = input.accountHolderName.trim();
  doc.bankName = input.bankName.trim();
  doc.ifsc = input.ifsc.trim();
  doc.amount = input.amount;
  doc.reverseBonus = nextReverseBonus;
  doc.payableAmount = payableAmount;
  await doc.save();

  await createAuditLog({
    actorId,
    action: "withdrawal.exchange_update",
    entity: "withdrawal",
    entityId: doc._id.toString(),
    oldValue: prev as unknown as Record<string, unknown>,
    newValue: {
      accountNumber: doc.accountNumber,
      accountHolderName: doc.accountHolderName,
      bankName: doc.bankName,
      ifsc: doc.ifsc,
      amount: doc.amount,
      reverseBonus: doc.reverseBonus,
      payableAmount: doc.payableAmount,
    } as unknown as Record<string, unknown>,
    requestId,
  });

  if (doc.player && Types.ObjectId.isValid(String(doc.player))) {
    const player = await PlayerModel.findById(doc.player).select("exchange").lean();
    if (player?.exchange) {
      await enqueueExchangeRecompute(String(player.exchange));
      await invalidateCacheDomains(["withdrawal", "exchange", "player"]);
    }
  }

  emitApprovalQueueEvent("withdrawal", "banker");
  return doc;
}

export async function updateWithdrawalByBanker(
  id: string,
  input: { bankId: string; utr: string },
  actorId: string,
  requestId?: string,
) {
  const startedAtMs = Date.now();
  const doc = await WithdrawalModel.findById(id);
  if (!doc) throw new AppError("not_found", "Withdrawal not found", 404);
  if (doc.status !== "requested") {
    throw new AppError("business_rule_error", "Only pending banker withdrawals can be updated", 400);
  }
  const utrTrim = normalizeUtr(input.utr);
  if (doc.utr && doc.utr.trim() !== "") {
    throw new AppError("business_rule_error", "UTR already recorded for this withdrawal", 400);
  }
  await ensureGlobalUtrUniqueForWithdrawal(utrTrim, doc._id);

  const bank = await BankModel.findById(input.bankId);
  if (!bank) throw new AppError("not_found", "Bank not found", 404);
  if (bank.status !== "active") throw new AppError("business_rule_error", "Bank is not active", 400);

  const prev = {
    payoutBankId: doc.payoutBankId?.toString(),
    payoutBankName: doc.payoutBankName,
    utr: doc.utr,
    status: doc.status,
  };

  doc.payoutBankId = new Types.ObjectId(input.bankId);
  doc.payoutBankName = bankDisplayName(bank);
  doc.utr = utrTrim;
  doc.status = "approved";
  await doc.save();

  const afterCoreCommitMs = Date.now();
  logger.info(
    {
      requestId,
      withdrawalId: doc._id.toString(),
      actorId,
      coreCommitMs: afterCoreCommitMs - startedAtMs,
    },
    "Withdrawal banker payout core commit completed",
  );

  const sideEffectContext = {
    requestId,
    withdrawalId: doc._id.toString(),
    actorId,
  };
  const runSideEffect = async (step: string, task: () => Promise<void> | void) => {
    const stepStartedAtMs = Date.now();
    try {
      await task();
      logger.info(
        { ...sideEffectContext, step, durationMs: Date.now() - stepStartedAtMs },
        "Withdrawal banker payout side-effect completed",
      );
    } catch (err) {
      logger.error({ err, ...sideEffectContext, step }, "Withdrawal banker payout side-effect failed");
    }
  };

  await runSideEffect("audit_log", async () => {
    await createAuditLog({
      actorId,
      action: "withdrawal.banker_payout",
      entity: "withdrawal",
      entityId: doc._id.toString(),
      oldValue: prev as unknown as Record<string, unknown>,
      newValue: {
        bankId: input.bankId,
        utr: utrTrim,
        status: "approved",
      } as unknown as Record<string, unknown>,
      requestId,
    });
  });
  await runSideEffect("emit_withdrawal_exchange_queue_event", () => {
    emitApprovalQueueEvent("withdrawal", "exchange");
  });

  logger.info(
    {
      ...sideEffectContext,
      totalDurationMs: Date.now() - startedAtMs,
    },
    "Withdrawal banker payout request completed",
  );
  return doc;
}

export type LastBankerPayoutMeta = { bankId: string; bankName: string } | null;

/** Latest company payout bank from this actor’s last banker payout (audit), not `withdrawal.createdBy`. */
async function lastBankerPayoutBankForActor(
  view: ListWithdrawalQuery["view"],
  actorId: string | undefined,
): Promise<LastBankerPayoutMeta> {
  if (view !== "banker" || !actorId || !Types.ObjectId.isValid(actorId)) return null;

  const log = await AuditLogModel.findOne({
    actorId: new Types.ObjectId(actorId),
    action: "withdrawal.banker_payout",
  })
    .sort({ createdAt: -1 })
    .select({ entityId: 1, newValue: 1 })
    .lean();

  if (!log?.entityId) return null;

  const withdrawal = await WithdrawalModel.findById(String(log.entityId).trim())
    .select({ payoutBankId: 1, payoutBankName: 1 })
    .lean();

  if (withdrawal?.payoutBankId) {
    const raw = withdrawal.payoutBankId as unknown;
    const bankId =
      raw != null && typeof raw === "object" && "_id" in (raw as object)
        ? String((raw as { _id?: unknown })._id)
        : String(raw);
    const bankName = typeof withdrawal.payoutBankName === "string" ? withdrawal.payoutBankName.trim() : "";
    if (bankId) return { bankId, bankName: bankName || "—" };
  }

  const nv = log.newValue;
  if (nv && typeof nv === "object" && nv !== null && "bankId" in nv) {
    const bankId = String((nv as { bankId?: unknown }).bankId ?? "").trim();
    if (bankId && Types.ObjectId.isValid(bankId)) {
      const bank = await BankModel.findById(bankId)
        .select({ holderName: 1, bankName: 1, accountNumber: 1 })
        .lean();
      if (bank && bank.holderName != null && bank.bankName != null) {
        const acct = String(bank.accountNumber ?? "");
        return {
          bankId,
          bankName: bankDisplayName({
            holderName: bank.holderName,
            bankName: bank.bankName,
            accountNumber: acct,
          }),
        };
      }
    }
  }

  return null;
}

export async function listWithdrawals(
  query: ListWithdrawalQuery,
  options?: { actorId?: string; timeZone?: string },
) {
  const timeZone = options?.timeZone || DEFAULT_TIMEZONE;
  const filter = buildWithdrawalListFilter(query, timeZone);
  const page = query.page;
  const pageSize = pageSizeFromQuery(query);
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;
  const sortField = query.sortBy;
  const supportsCursor = sortValue === -1 && (sortField === "requestedAt" || sortField === "createdAt");
  const cursor = supportsCursor ? decodeTimeCursor(query.cursor) : null;
  const queryFilter: Record<string, unknown> = { ...filter };
  if (cursor) {
    const cursorDate = new Date(cursor.t);
    if (!Number.isNaN(cursorDate.getTime()) && Types.ObjectId.isValid(cursor.id)) {
      queryFilter.$or = [
        { [sortField]: { $lt: cursorDate } },
        { [sortField]: cursorDate, _id: { $lt: new Types.ObjectId(cursor.id) } },
      ];
    }
  }

  const [rows, total, lastBankerPayout] = await Promise.all([
    WithdrawalModel.find(queryFilter)
      .populate("player", "playerId phone")
      .populate("payoutBankId", "holderName bankName accountNumber")
      .populate("createdBy", "fullName username")
      .populate("lastAmendedBy", "fullName username")
      .sort({ [sortField]: sortValue })
      .skip(cursor ? 0 : skip)
      .limit(pageSize)
      .lean(),
    WithdrawalModel.countDocuments(filter),
    lastBankerPayoutBankForActor(query.view, options?.actorId),
  ]);

  const meta: {
    total: number;
    page: number;
    pageSize: number;
    lastBankerPayout?: LastBankerPayoutMeta;
  } = {
    total,
    page,
    pageSize,
  };
  if (query.view === "banker") {
    meta.lastBankerPayout = lastBankerPayout;
  }
  const lastRow = rows[rows.length - 1] as { _id?: unknown; requestedAt?: Date; createdAt?: Date } | undefined;
  if (cursor && lastRow?._id) {
    const ts = sortField === "requestedAt" ? (lastRow.requestedAt ?? lastRow.createdAt) : lastRow.createdAt;
    if (ts) {
      (meta as Record<string, unknown>).nextCursor = encodeTimeCursor({ t: ts, id: String(lastRow._id) });
    }
  }

  return {
    rows,
    meta,
  };
}

export async function updateWithdrawalStatus(
  id: string,
  input: { status: "finalized" } | { status: "rejected"; reasonId: string; remark?: string },
  actorId: string,
  requestId?: string,
) {
  const doc = await WithdrawalModel.findById(id);
  if (!doc) throw new AppError("not_found", "Withdrawal not found", 404);
  const status = input.status;
  const transitions: Record<WithdrawalStatus, WithdrawalStatus[]> = {
    requested: ["rejected"],
    approved: ["finalized", "rejected"],
    rejected: [],
    finalized: [],
  };
  if (!transitions[doc.status].includes(status)) {
    throw new AppError("business_rule_error", "Invalid status transition", 400);
  }
  const old = doc.status;
  doc.status = status;

  let newValue: Record<string, unknown> = { status };
  if (status === "rejected") {
    const resolved = await loadActiveReasonForReject(input.reasonId, REASON_TYPES.WITHDRAWAL_BANKER_REJECT);
    const rejectText = composeRejectReasonText(resolved.masterText, input.remark);
    doc.rejectReason = rejectText;
    doc.rejectReasonId = new Types.ObjectId(resolved.id);
    newValue = {
      status,
      rejectReason: rejectText,
      rejectReasonId: resolved.id,
      remark: input.remark?.trim() || undefined,
    };
  }

  await doc.save();
  await createAuditLog({
    actorId,
    action: "withdrawal.status_update",
    entity: "withdrawal",
    entityId: doc._id.toString(),
    oldValue: { status: old },
    newValue,
    requestId,
  });

  if (status === "finalized" || status === "rejected") {
    if (doc.player && Types.ObjectId.isValid(String(doc.player))) {
      const player = await PlayerModel.findById(doc.player).select("exchange").lean();
      if (player?.exchange) {
        await enqueueExchangeRecompute(String(player.exchange));
        await invalidateCacheDomains(["withdrawal", "exchange", "player"]);
      }
    }
  }
  emitApprovalQueueEvent("withdrawal", "exchange");
  return doc;
}

export async function listSavedAccountsForPlayer(playerId: string) {
  if (!Types.ObjectId.isValid(playerId)) {
    throw new AppError("validation_error", "Invalid player id", 400);
  }
  const rows = await WithdrawalModel.find({
    player: new Types.ObjectId(playerId),
    accountNumber: { $nin: [null, ""] },
  })
    .sort({ updatedAt: -1 })
    .limit(300)
    .select("accountNumber accountHolderName bankName ifsc")
    .lean();

  const seen = new Set<string>();
  const out: {
    accountNumber: string;
    accountHolderName: string;
    bankName: string;
    ifsc: string;
  }[] = [];

  for (const r of rows) {
    const acc = String(r.accountNumber ?? "").trim();
    const ifsc = String(r.ifsc ?? "").trim();
    if (!acc) continue;
    const key = `${acc}|${ifsc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      accountNumber: acc,
      accountHolderName: String(r.accountHolderName ?? "").trim(),
      bankName: String(r.bankName ?? "").trim(),
      ifsc,
    });
  }

  return out;
}

const EXPORT_MAX_ROWS = 10_000;

export async function exportWithdrawalsToBuffer(
  query: ListWithdrawalQuery,
  options?: { timeZone?: string },
): Promise<Buffer> {
  const timeZone = options?.timeZone || DEFAULT_TIMEZONE;
  const filter = buildWithdrawalListFilter(query, timeZone);
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const rows = await WithdrawalModel.find(filter)
    .populate("player", "playerId phone")
    .populate("payoutBankId", "holderName bankName accountNumber")
    .populate("createdBy", "fullName username")
    .sort({ [query.sortBy]: sortValue })
    .limit(EXPORT_MAX_ROWS)
    .lean();

  return generateExcelBuffer(rows, [
    { header: "Player ID", transform: (r) => (r.player as any)?.playerId ?? "" },
    { header: "Player Phone", transform: (r) => (r.player as any)?.phone ?? "" },
    { header: "Account Number", key: "accountNumber" },
    { header: "Account Holder", key: "accountHolderName" },
    { header: "Bank", key: "bankName" },
    { header: "IFSC", key: "ifsc" },
    { header: "Amount", transform: (r) => Math.round(Number(r.amount ?? 0)) },
    { header: "Reverse Bonus", transform: (r) => Math.round(Number(r.reverseBonus ?? 0)) },
    { header: "Payable Amount", transform: (r) => Math.round(Number(r.payableAmount ?? 0)) },
    { header: "Status", key: "status" },
    { header: "UTR", key: "utr" },
    { header: "Payout Bank", key: "payoutBankName" },
    { header: "Amendment Count", key: "amendmentCount" },
    {
      header: "Last Amended At",
      transform: (r) => formatDateTimeForTimeZone(r.lastAmendedAt, timeZone),
    },
    { header: "Created By", transform: (r) => (r.createdBy as any)?.fullName ?? "" },
    {
      header: "Transaction At",
      transform: (r) => formatDateTimeForTimeZone(r.requestedAt ?? r.createdAt, timeZone),
    },
  ], "Withdrawals");
}

export async function deleteWithdrawalWithReversal(id: string, actorId: string, requestId?: string) {
  const doc = await WithdrawalModel.findById(id);
  if (!doc) throw new AppError("not_found", "Withdrawal not found", 404);

  const oldValue = {
    playerId: doc.player?.toString(),
    playerName: doc.playerName,
    amount: doc.amount,
    reverseBonus: doc.reverseBonus,
    payableAmount: doc.payableAmount,
    payoutBankId: doc.payoutBankId?.toString(),
    payoutBankName: doc.payoutBankName,
    utr: doc.utr,
    status: doc.status,
    requestedAt: doc.requestedAt,
    amendmentCount: doc.amendmentCount,
    amendmentHistory: doc.amendmentHistory ?? [],
    createdAt: doc.createdAt,
  };

  const impactedBankIds = new Set<string>();
  if (doc.payoutBankId && Types.ObjectId.isValid(String(doc.payoutBankId))) {
    impactedBankIds.add(String(doc.payoutBankId));
  }
  for (const entry of doc.amendmentHistory ?? []) {
    const oldBankId = entry.old?.payoutBankId;
    const newBankId = entry.new?.payoutBankId;
    if (oldBankId && Types.ObjectId.isValid(oldBankId)) impactedBankIds.add(oldBankId);
    if (newBankId && Types.ObjectId.isValid(newBankId)) impactedBankIds.add(newBankId);
  }
  const shouldNormalizeBanks =
    doc.status === "approved" ||
    doc.status === "finalized" ||
    (doc.amendmentCount ?? 0) > 0 ||
    (doc.amendmentHistory?.length ?? 0) > 0;

  await WithdrawalModel.deleteOne({ _id: doc._id });

  let recomputedExchangeId: string | undefined;
  if (doc.player && Types.ObjectId.isValid(String(doc.player))) {
    const player = await PlayerModel.findById(doc.player).select("exchange").lean();
    if (player?.exchange) {
      recomputedExchangeId = String(player.exchange);
      await enqueueExchangeRecompute(recomputedExchangeId);
      await invalidateCacheDomains(["withdrawal", "exchange", "player"]);
    }
  }

  if (shouldNormalizeBanks && impactedBankIds.size > 0) {
    await normalizeBankCurrentBalances([...impactedBankIds]);
  }

  await createAuditLog({
    actorId,
    action: "withdrawal.delete",
    entity: "withdrawal",
    entityId: String(doc._id),
    oldValue: oldValue as unknown as Record<string, unknown>,
    newValue: {
      deleted: true,
      reversal: {
        status: doc.status,
        normalizedBankIds: [...impactedBankIds],
        recomputedExchangeId,
      },
    },
    requestId,
  });

  return { id: String(doc._id), deleted: true };
}

export async function amendWithdrawal(
  id: string,
  input: AmendWithdrawalInput,
  actorId: string,
  requestId?: string,
) {
  const doc = await WithdrawalModel.findById(id);
  if (!doc) throw new AppError("not_found", "Withdrawal not found", 404);
  if (doc.status !== "approved") {
    throw new AppError("business_rule_error", "Only approved withdrawals can be amended", 400);
  }
  if (!doc.payoutBankId) {
    throw new AppError("business_rule_error", "Withdrawal has no payout bank linked", 400);
  }

  const newBank = await BankModel.findById(input.payoutBankId);
  if (!newBank) throw new AppError("not_found", "Bank not found", 404);
  if (newBank.status !== "active") throw new AppError("business_rule_error", "Bank is not active", 400);
  const utrTrim = normalizeUtr(input.utr);
  if (utrTrim !== normalizeUtr(doc.utr ?? "")) {
    await ensureGlobalUtrUniqueForWithdrawal(utrTrim, doc._id);
  }

  const oldPayable = Number(doc.payableAmount ?? payableFromAmounts(doc.amount, doc.reverseBonus ?? 0));
  const newPayable = payableFromAmounts(input.amount, input.reverseBonus);
  const nextRequestedAt = input.requestedAt
    ? parseBusinessDateTime(input.requestedAt, "requestedAt")
    : doc.requestedAt;
  const resolved = await loadActiveReasonForReject(input.reasonId, REASON_TYPES.WITHDRAWAL_FINAL_AMEND);
  const amendReasonText = composeRejectReasonText(resolved.masterText, input.remark);
  const oldBankId = String(doc.payoutBankId);
  const newBankId = input.payoutBankId;

  const oldSnapshot: WithdrawalAmendmentSnapshot = {
    amount: doc.amount,
    reverseBonus: doc.reverseBonus,
    payableAmount: doc.payableAmount,
    payoutBankId: oldBankId,
    payoutBankName: doc.payoutBankName,
    utr: doc.utr,
  };
  const oldRequestedAt = doc.requestedAt;
  const newSnapshot: WithdrawalAmendmentSnapshot = {
    amount: input.amount,
    reverseBonus: input.reverseBonus,
    payableAmount: newPayable,
    payoutBankId: newBankId,
    payoutBankName: bankDisplayName(newBank),
    utr: utrTrim,
  };

  let rollbackBankChanges: (() => Promise<void>) | undefined;
  if (oldBankId === newBankId) {
    const bank = await BankModel.findById(oldBankId);
    if (!bank) throw new AppError("not_found", "Bank not found", 404);
    const prevBal = bank.currentBalance ?? bank.openingBalance;
    const delta = newPayable - oldPayable;
    bank.currentBalance = prevBal - delta;
    await bank.save();
    rollbackBankChanges = async () => {
      bank.currentBalance = prevBal;
      await bank.save();
    };
  } else {
    const oldBank = await BankModel.findById(oldBankId);
    if (!oldBank) throw new AppError("not_found", "Bank not found", 404);
    const oldPrev = oldBank.currentBalance ?? oldBank.openingBalance;
    oldBank.currentBalance = oldPrev + oldPayable;
    await oldBank.save();

    const newBankDoc = await BankModel.findById(newBankId);
    if (!newBankDoc) {
      oldBank.currentBalance = oldPrev;
      await oldBank.save();
      throw new AppError("not_found", "Bank not found", 404);
    }
    const newPrev = newBankDoc.currentBalance ?? newBankDoc.openingBalance;
    newBankDoc.currentBalance = newPrev - newPayable;
    try {
      await newBankDoc.save();
    } catch (err) {
      oldBank.currentBalance = oldPrev;
      await oldBank.save();
      throw err;
    }
    rollbackBankChanges = async () => {
      oldBank.currentBalance = oldPrev;
      await oldBank.save();
      newBankDoc.currentBalance = newPrev;
      await newBankDoc.save();
    };
  }

  try {
    doc.amount = input.amount;
    doc.reverseBonus = input.reverseBonus;
    doc.payableAmount = newPayable;
    doc.payoutBankId = new Types.ObjectId(newBankId);
    doc.payoutBankName = newSnapshot.payoutBankName ?? doc.payoutBankName;
    doc.utr = utrTrim;
    doc.requestedAt = nextRequestedAt;
    doc.amendmentCount = (doc.amendmentCount ?? 0) + 1;
    doc.lastAmendedAt = new Date();
    doc.lastAmendedBy = new Types.ObjectId(actorId);
    const history = doc.amendmentHistory ?? [];
    history.push({
      at: new Date(),
      by: new Types.ObjectId(actorId),
      reason: amendReasonText,
      old: oldSnapshot,
      new: newSnapshot,
    });
    doc.amendmentHistory = history;
    await doc.save();
  } catch (err) {
    if (rollbackBankChanges) await rollbackBankChanges();
    throw err;
  }

  await createAuditLog({
    actorId,
    action: "withdrawal.amend",
    entity: "withdrawal",
    entityId: doc._id.toString(),
    oldValue: { ...oldSnapshot, requestedAt: oldRequestedAt } as unknown as Record<string, unknown>,
    newValue: {
      ...newSnapshot,
      requestedAt: nextRequestedAt,
      reason: amendReasonText,
      reasonId: resolved.id,
      remark: input.remark?.trim() || undefined,
    } as unknown as Record<string, unknown>,
    requestId,
  });

  if (doc.player && Types.ObjectId.isValid(String(doc.player))) {
    const player = await PlayerModel.findById(doc.player).select("exchange").lean();
    if (player?.exchange) {
      await enqueueExchangeRecompute(String(player.exchange));
      await invalidateCacheDomains(["withdrawal", "exchange", "player"]);
    }
  }

  return doc;
}

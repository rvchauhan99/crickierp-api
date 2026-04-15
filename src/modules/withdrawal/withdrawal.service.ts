import { Types } from "mongoose";
import type { z } from "zod";
import { generateExcelBuffer } from "../../shared/services/excel.service";
import { REASON_TYPES } from "../../shared/constants/reasonTypes";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { BankModel } from "../bank/bank.model";
import { recomputeExchangeCurrentBalance } from "../exchange/exchange.service";
import { PlayerModel } from "../player/player.model";
import { composeRejectReasonText, loadActiveReasonForReject } from "../reason/reasonLookup.service";
import { WithdrawalModel, WithdrawalStatus } from "./withdrawal.model";
import { listWithdrawalQuerySchema } from "./withdrawal.validation";

type ListWithdrawalQuery = z.infer<typeof listWithdrawalQuerySchema>;

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
  const f = trimUndef(from);
  const t = trimUndef(to);
  const operator = op || "inRange";
  if (operator === "inRange" && f && t) {
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

function buildWithdrawalListFilter(q: ListWithdrawalQuery): Record<string, unknown> {
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

  const dateCond = createdAtCondition(
    trimUndef(q.createdAt_from),
    trimUndef(q.createdAt_to),
    trimUndef(q.createdAt_op),
  );
  if (dateCond) conditions.push(dateCond);

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
  return Math.max(0, Math.round(raw * 100) / 100);
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
    } as unknown as Record<string, unknown>,
    requestId,
  });

  if (doc.player && Types.ObjectId.isValid(String(doc.player))) {
    const player = await PlayerModel.findById(doc.player).select("exchange").lean();
    if (player?.exchange) {
      await recomputeExchangeCurrentBalance(String(player.exchange));
    }
  }

  return doc;
}

export async function updateWithdrawalByBanker(
  id: string,
  input: { bankId: string; utr: string },
  actorId: string,
  requestId?: string,
) {
  const doc = await WithdrawalModel.findById(id);
  if (!doc) throw new AppError("not_found", "Withdrawal not found", 404);
  if (doc.status !== "requested") {
    throw new AppError("business_rule_error", "Only pending banker withdrawals can be updated", 400);
  }
  const utrTrim = input.utr.trim();
  if (doc.utr && doc.utr.trim() !== "") {
    throw new AppError("business_rule_error", "UTR already recorded for this withdrawal", 400);
  }

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

  return doc;
}

export async function listWithdrawals(query: ListWithdrawalQuery) {
  const filter = buildWithdrawalListFilter(query);
  const page = query.page;
  const pageSize = pageSizeFromQuery(query);
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;
  const sortField = query.sortBy;

  const [rows, total] = await Promise.all([
    WithdrawalModel.find(filter)
      .populate("player", "playerId phone")
      .populate("payoutBankId", "holderName bankName accountNumber")
      .populate("createdBy", "fullName username")
      .sort({ [sortField]: sortValue })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    WithdrawalModel.countDocuments(filter),
  ]);

  return {
    rows,
    meta: {
      total,
      page,
      pageSize,
    },
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
        await recomputeExchangeCurrentBalance(String(player.exchange));
      }
    }
  }
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

export async function exportWithdrawalsToBuffer(query: ListWithdrawalQuery): Promise<Buffer> {
  const filter = buildWithdrawalListFilter(query);
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
    { header: "Amount", key: "amount" },
    { header: "Reverse Bonus", key: "reverseBonus" },
    { header: "Payable Amount", key: "payableAmount" },
    { header: "Status", key: "status" },
    { header: "UTR", key: "utr" },
    { header: "Payout Bank", key: "payoutBankName" },
    { header: "Created By", transform: (r) => (r.createdBy as any)?.fullName ?? "" },
    { header: "Created At", transform: (r) => (r.createdAt ? new Date(r.createdAt).toISOString() : "") },
  ], "Withdrawals");
}

import mongoose, { Types } from "mongoose";
import type { z } from "zod";
import xlsx from "xlsx";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { BankModel } from "../bank/bank.model";
import { PlayerModel } from "../player/player.model";
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
  if (statusFilter == null && (q.view === "banker" || q.view === "exchange")) {
    statusFilter = "pending";
  }
  if (
    statusFilter === "pending" ||
    statusFilter === "verified" ||
    statusFilter === "rejected" ||
    statusFilter === "finalized"
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

export async function createDeposit(
  input: { bankId: string; utr: string; amount: number },
  actorId: string,
  requestId?: string,
) {
  const exists = await DepositModel.findOne({ utr: input.utr });
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

export async function listDeposits(query: ListDepositQuery) {
  const filter = buildDepositListFilter(query);
  const page = query.page;
  const pageSize = pageSizeFromQuery(query);
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;
  const sortField = query.sortBy;

  const [rows, total] = await Promise.all([
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

  const exportData = rows.map((r) => ({
    UTR: r.utr,
    "Bank label": r.bankName,
    Amount: r.amount,
    Status: r.status,
    "Bonus amount": r.bonusAmount ?? "",
    "Total amount": r.totalAmount ?? "",
    "Reject reason": r.rejectReason ?? "",
    "Bank balance after": r.bankBalanceAfter ?? "",
    "Settled at": r.settledAt ? new Date(r.settledAt).toISOString() : "",
    "Created at": r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }));

  const worksheet = xlsx.utils.json_to_sheet(exportData);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Deposits");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function exchangeApproveDeposit(
  id: string,
  input: { playerId: string; bonusAmount: number },
  actorId: string,
  requestId?: string,
) {
  const bonus = Number(input.bonusAmount);
  if (!Number.isFinite(bonus) || bonus < 0) {
    throw new AppError("validation_error", "Invalid bonus amount", 400);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const doc = await DepositModel.findById(id).session(session);
    if (!doc) throw new AppError("not_found", "Deposit not found", 404);
    if (doc.status !== "pending") {
      throw new AppError("business_rule_error", "Deposit is not pending exchange action", 400);
    }
    if (!doc.bankId) {
      throw new AppError("business_rule_error", "Deposit has no bank linked", 400);
    }

    const playerDoc = await PlayerModel.findById(input.playerId).session(session);
    if (!playerDoc) throw new AppError("not_found", "Player not found", 404);

    const totalAmount = doc.amount + bonus;
    const bank = await BankModel.findById(doc.bankId).session(session);
    if (!bank) throw new AppError("not_found", "Bank not found", 404);

    const prev = bank.currentBalance ?? bank.openingBalance;
    const bankBalanceAfter = prev + totalAmount;

    bank.currentBalance = bankBalanceAfter;
    await bank.save({ session });

    doc.status = "verified" as DepositStatus;
    doc.player = new Types.ObjectId(input.playerId);
    doc.bonusAmount = bonus;
    doc.totalAmount = totalAmount;
    doc.exchangeActionBy = new Types.ObjectId(actorId);
    doc.exchangeActionAt = new Date();
    doc.bankBalanceAfter = bankBalanceAfter;
    doc.settledAt = new Date();
    await doc.save({ session });

    await createAuditLog({
      actorId,
      action: "deposit.exchange_approve",
      entity: "deposit",
      entityId: doc._id.toString(),
      newValue: {
        playerId: input.playerId,
        bonusAmount: bonus,
        totalAmount,
        bankBalanceAfter,
      },
      requestId,
    });

    await session.commitTransaction();
    return doc;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

export async function exchangeRejectDeposit(
  id: string,
  remark: string,
  actorId: string,
  requestId?: string,
) {
  const doc = await DepositModel.findById(id);
  if (!doc) throw new AppError("not_found", "Deposit not found", 404);
  if (doc.status !== "pending") {
    throw new AppError("business_rule_error", "Deposit is not pending exchange action", 400);
  }

  doc.status = "rejected";
  doc.rejectReason = remark.trim();
  doc.exchangeActionBy = new Types.ObjectId(actorId);
  doc.exchangeActionAt = new Date();
  await doc.save();

  await createAuditLog({
    actorId,
    action: "deposit.exchange_reject",
    entity: "deposit",
    entityId: doc._id.toString(),
    newValue: { rejectReason: remark },
    requestId,
  });
  return doc;
}

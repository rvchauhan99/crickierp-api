import { Types } from "mongoose";
import type { z } from "zod";
import { REASON_TYPES } from "../../shared/constants/reasonTypes";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { BankModel } from "../bank/bank.model";
import { ExpenseTypeModel } from "../masters/expense-type.model";
import { composeRejectReasonText, loadActiveReasonForReject } from "../reason/reasonLookup.service";
import { ExpenseModel, ExpenseStatus } from "./expense.model";
import { listExpenseQuerySchema } from "./expense.validation";

type ListExpenseQuery = z.infer<typeof listExpenseQuerySchema>;

function pageSizeFromQuery(q: ListExpenseQuery): number {
  return q.limit ?? q.pageSize;
}

function bankDisplayName(b: { holderName: string; bankName: string; accountNumber: string }): string {
  const last4 = String(b.accountNumber ?? "").slice(-4);
  return `${b.holderName} — ${b.bankName}${last4 ? ` (${last4})` : ""}`.trim();
}

function parseYmdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function trimUndef(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  const t = String(s).trim();
  return t === "" ? undefined : t;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/** Date filter for `expenseDate` (aligned with deposit `createdAtCondition`; default op equals when a single bound is used). */
function expenseDateCondition(
  from: string | undefined,
  to: string | undefined,
  op: string | undefined,
): Record<string, unknown> | null {
  const f = trimUndef(from);
  const t = trimUndef(to);
  const rawOp = trimUndef(op);
  const effectiveOp =
    rawOp || (f && t ? "inRange" : f || t ? "equals" : "");

  if (effectiveOp === "inRange" && f && t) {
    const start = ymdStart(f);
    const end = ymdEnd(t);
    if (!start || !end) return null;
    return { expenseDate: { $gte: start, $lte: end } };
  }
  if (effectiveOp === "equals" && f) {
    const start = ymdStart(f);
    const end = ymdEnd(f);
    if (!start || !end) return null;
    return { expenseDate: { $gte: start, $lte: end } };
  }
  if (effectiveOp === "before" && f) {
    const start = ymdStart(f);
    if (!start) return null;
    return { expenseDate: { $lt: start } };
  }
  if (effectiveOp === "after" && f) {
    const end = ymdEnd(f);
    if (!end) return null;
    return { expenseDate: { $gt: end } };
  }
  if (f && t) {
    const start = ymdStart(f);
    const end = ymdEnd(t);
    if (!start || !end) return null;
    return { expenseDate: { $gte: start, $lte: end } };
  }
  if (f) {
    const start = ymdStart(f);
    if (!start) return null;
    return { expenseDate: { $gte: start } };
  }
  if (t) {
    const end = ymdEnd(t);
    if (!end) return null;
    return { expenseDate: { $lte: end } };
  }
  return null;
}

function buildListFilter(q: ListExpenseQuery): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  const search = trimUndef(q.search);
  if (search) {
    const esc = escapeRegex(search);
    conditions.push({
      $or: [
        { description: { $regex: esc, $options: "i" } },
        { bankName: { $regex: esc, $options: "i" } },
        { rejectReason: { $regex: esc, $options: "i" } },
      ],
    });
  }

  const st = trimUndef(q.status);
  if (st === "pending_audit" || st === "approved" || st === "rejected") {
    conditions.push({ status: st as ExpenseStatus });
  }

  const expenseTypeId = trimUndef(q.expenseTypeId);
  if (expenseTypeId && Types.ObjectId.isValid(expenseTypeId)) {
    conditions.push({ expenseTypeId: new Types.ObjectId(expenseTypeId) });
  }

  const bankId = trimUndef(q.bankId);
  if (bankId && Types.ObjectId.isValid(bankId)) {
    conditions.push({ bankId: new Types.ObjectId(bankId) });
  }

  const dateCond = expenseDateCondition(
    trimUndef(q.expenseDate_from),
    trimUndef(q.expenseDate_to),
    trimUndef(q.expenseDate_op),
  );
  if (dateCond) conditions.push(dateCond);

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

export async function createExpense(
  input: {
    expenseTypeId: string;
    amount: number;
    expenseDate: string;
    description?: string;
    bankId?: string;
  },
  actorId: string,
  requestId?: string,
) {
  const et = await ExpenseTypeModel.findById(input.expenseTypeId);
  if (!et || et.deletedAt) throw new AppError("not_found", "Expense type not found", 404);
  if (!et.isActive) throw new AppError("business_rule_error", "Expense type is inactive", 400);

  let bankName = "";
  let bankObjectId: Types.ObjectId | undefined;
  if (input.bankId) {
    const bank = await BankModel.findById(input.bankId);
    if (!bank) throw new AppError("not_found", "Bank not found", 404);
    if (bank.status !== "active") throw new AppError("business_rule_error", "Bank is not active", 400);
    bankObjectId = bank._id;
    bankName = bankDisplayName(bank);
  }

  const doc = await ExpenseModel.create({
    expenseTypeId: new Types.ObjectId(input.expenseTypeId),
    amount: input.amount,
    expenseDate: parseYmdToDate(input.expenseDate),
    description: input.description?.trim() ?? "",
    bankId: bankObjectId,
    bankName,
    status: "pending_audit" as const,
    createdBy: new Types.ObjectId(actorId),
  });

  await createAuditLog({
    actorId,
    action: "expense.create",
    entity: "expense",
    entityId: doc._id.toString(),
    newValue: {
      expenseTypeId: input.expenseTypeId,
      amount: input.amount,
      expenseDate: input.expenseDate,
      bankId: input.bankId,
    },
    requestId,
  });

  return doc;
}

export async function updateExpense(
  id: string,
  input: {
    expenseTypeId?: string;
    amount?: number;
    expenseDate?: string;
    description?: string;
    bankId?: string | null;
  },
  actorId: string,
  requestId?: string,
) {
  const doc = await ExpenseModel.findById(id);
  if (!doc) throw new AppError("not_found", "Expense not found", 404);
  if (doc.status !== "pending_audit") {
    throw new AppError("business_rule_error", "Only pending expenses can be edited", 400);
  }

  const prev = {
    expenseTypeId: doc.expenseTypeId.toString(),
    amount: doc.amount,
    expenseDate: doc.expenseDate,
    description: doc.description,
    bankId: doc.bankId?.toString(),
  };

  if (input.expenseTypeId !== undefined) {
    const et = await ExpenseTypeModel.findById(input.expenseTypeId);
    if (!et || et.deletedAt) throw new AppError("not_found", "Expense type not found", 404);
    if (!et.isActive) throw new AppError("business_rule_error", "Expense type is inactive", 400);
    doc.expenseTypeId = new Types.ObjectId(input.expenseTypeId);
  }

  if (input.amount !== undefined) doc.amount = input.amount;
  if (input.expenseDate !== undefined) doc.expenseDate = parseYmdToDate(input.expenseDate);
  if (input.description !== undefined) doc.description = input.description.trim();

  if (input.bankId !== undefined) {
    if (input.bankId === "" || input.bankId === null) {
      doc.bankId = undefined;
      doc.bankName = "";
    } else {
      const bank = await BankModel.findById(input.bankId);
      if (!bank) throw new AppError("not_found", "Bank not found", 404);
      if (bank.status !== "active") throw new AppError("business_rule_error", "Bank is not active", 400);
      doc.bankId = bank._id;
      doc.bankName = bankDisplayName(bank);
    }
  }

  doc.updatedBy = new Types.ObjectId(actorId);
  await doc.save();

  await createAuditLog({
    actorId,
    action: "expense.update",
    entity: "expense",
    entityId: doc._id.toString(),
    oldValue: prev as unknown as Record<string, unknown>,
    newValue: {
      expenseTypeId: doc.expenseTypeId.toString(),
      amount: doc.amount,
      expenseDate: doc.expenseDate,
      description: doc.description,
      bankId: doc.bankId?.toString(),
    },
    requestId,
  });

  return doc;
}

export async function approveExpense(
  id: string,
  input: { bankId: string },
  actorId: string,
  requestId?: string,
) {
  const doc = await ExpenseModel.findById(id);
  if (!doc) throw new AppError("not_found", "Expense not found", 404);
  if (doc.status !== "pending_audit") {
    throw new AppError("business_rule_error", "Expense is not pending audit", 400);
  }

  const bank = await BankModel.findById(input.bankId);
  if (!bank) throw new AppError("not_found", "Bank not found", 404);
  if (bank.status !== "active") throw new AppError("business_rule_error", "Bank is not active", 400);

  const amount = doc.amount;
  const prevBal = bank.currentBalance ?? bank.openingBalance;
  if (amount > prevBal) {
    throw new AppError("business_rule_error", "Insufficient bank balance for this expense", 400);
  }

  const bankBalanceAfter = prevBal - amount;
  bank.currentBalance = bankBalanceAfter;
  await bank.save();

  try {
    doc.bankId = bank._id;
    doc.bankName = bankDisplayName(bank);
    doc.status = "approved";
    doc.approvedBy = new Types.ObjectId(actorId);
    doc.approvedAt = new Date();
    doc.bankBalanceAfter = bankBalanceAfter;
    doc.updatedBy = new Types.ObjectId(actorId);
    await doc.save();
  } catch (err) {
    bank.currentBalance = prevBal;
    await bank.save();
    throw err;
  }

  await createAuditLog({
    actorId,
    action: "expense.approve",
    entity: "expense",
    entityId: doc._id.toString(),
    newValue: {
      bankId: input.bankId,
      bankBalanceAfter,
      amount,
    },
    requestId,
  });

  return doc;
}

export async function rejectExpense(
  id: string,
  input: { reasonId: string; remark?: string },
  actorId: string,
  requestId?: string,
) {
  const resolved = await loadActiveReasonForReject(input.reasonId, REASON_TYPES.EXPENSE_AUDIT_REJECT);
  const rejectText = composeRejectReasonText(resolved.masterText, input.remark);

  const doc = await ExpenseModel.findById(id);
  if (!doc) throw new AppError("not_found", "Expense not found", 404);
  if (doc.status !== "pending_audit") {
    throw new AppError("business_rule_error", "Expense is not pending audit", 400);
  }

  doc.status = "rejected";
  doc.rejectReason = rejectText;
  doc.rejectReasonId = new Types.ObjectId(resolved.id);
  doc.updatedBy = new Types.ObjectId(actorId);
  await doc.save();

  await createAuditLog({
    actorId,
    action: "expense.reject",
    entity: "expense",
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

export async function listExpenses(query: ListExpenseQuery) {
  const filter = buildListFilter(query);
  const page = query.page;
  const pageSize = pageSizeFromQuery(query);
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const [rows, total] = await Promise.all([
    ExpenseModel.find(filter)
      .populate("expenseTypeId", "name code isActive")
      .populate("bankId", "holderName bankName accountNumber")
      .populate("createdBy", "fullName username")
      .populate("approvedBy", "fullName username")
      .sort({ [query.sortBy]: sortValue })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    ExpenseModel.countDocuments(filter),
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

export async function listActiveExpenseTypes() {
  const rows = await ExpenseTypeModel.find({
    isActive: true,
    deletedAt: null,
  })
    .sort({ name: 1 })
    .select("_id name code description")
    .lean();
  return rows;
}

export async function getExpenseById(id: string) {
  const doc = await ExpenseModel.findById(id)
    .populate("expenseTypeId", "name code isActive")
    .populate("bankId", "holderName bankName accountNumber ifsc")
    .populate("createdBy", "fullName username")
    .populate("approvedBy", "fullName username")
    .lean();
  if (!doc) throw new AppError("not_found", "Expense not found", 404);
  return doc;
}

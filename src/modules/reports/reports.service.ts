import { Types } from "mongoose";
import type { z } from "zod";
import { AuditLogModel } from "../audit/audit.model";
import { ExchangeModel } from "../exchange/exchange.model";
import { UserModel } from "../users/user.model";
import { ExpenseModel, type ExpenseStatus } from "../expense/expense.model";
import { AUDIT_ENTITY_AUTH } from "../../shared/constants/auditEntities";
import {
  expenseAnalysisFilterQuerySchema,
  expenseAnalysisRecordsQuerySchema,
  transactionHistoryQuerySchema,
} from "./reports.validation";

type ExpenseAnalysisFilterQuery = z.infer<typeof expenseAnalysisFilterQuerySchema>;
type ExpenseAnalysisRecordsQuery = z.infer<typeof expenseAnalysisRecordsQuerySchema>;
type TransactionHistoryQuery = z.infer<typeof transactionHistoryQuerySchema>;

/** Transaction reports exclude login audits; login history is auth rows only. */
export type AuditHistoryScope = "transactions" | "login";

function escapeRegexFragment(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type DateRangeQuery = {
  fromDate?: string;
  toDate?: string;
};

function buildDateFilter(query: DateRangeQuery) {
  if (!query.fromDate && !query.toDate) return {};
  const createdAt: { $gte?: Date; $lte?: Date } = {};
  if (query.fromDate) createdAt.$gte = new Date(query.fromDate);
  if (query.toDate) createdAt.$lte = new Date(`${query.toDate}T23:59:59.999Z`);
  return { createdAt };
}

export async function getDashboardSummary(query: DateRangeQuery) {
  const filter = buildDateFilter(query);
  const [totalExchanges, activeExchanges, totalUsers, recentAudits] = await Promise.all([
    ExchangeModel.countDocuments({ ...filter }),
    ExchangeModel.countDocuments({ ...filter, status: "active" }),
    UserModel.countDocuments({ status: "active" }),
    AuditLogModel.countDocuments({ ...filter }),
  ]);

  return {
    totalExchanges,
    activeExchanges,
    totalUsers,
    auditEvents: recentAudits,
  };
}

export async function getTransactionHistory(
  query: TransactionHistoryQuery,
  options: { scope: AuditHistoryScope },
) {
  const dateFilter = buildDateFilter(query);
  const conditions: Record<string, unknown>[] = [];

  if (options.scope === "transactions") {
    conditions.push({ entity: { $ne: AUDIT_ENTITY_AUTH } });
  } else {
    conditions.push({ entity: AUDIT_ENTITY_AUTH });
  }

  if (Object.keys(dateFilter).length > 0) {
    conditions.push(dateFilter);
  }

  if (query.search) {
    const esc = escapeRegexFragment(query.search);
    const searchOr: Record<string, unknown>[] = [
      { action: { $regex: esc, $options: "i" } },
      { entity: { $regex: esc, $options: "i" } },
      { entityId: { $regex: esc, $options: "i" } },
      { reason: { $regex: esc, $options: "i" } },
      { ipAddress: { $regex: esc, $options: "i" } },
    ];
    if (options.scope === "transactions") {
      searchOr.splice(3, 0, { requestId: { $regex: esc, $options: "i" } });
    }
    conditions.push({ $or: searchOr });
  }

  if (options.scope === "transactions" && query.entity) {
    conditions.push({ entity: query.entity.trim() });
  }
  if (query.action) {
    conditions.push({ action: { $regex: escapeRegexFragment(query.action), $options: "i" } });
  }
  if (query.actorId && Types.ObjectId.isValid(query.actorId)) {
    conditions.push({ actorId: new Types.ObjectId(query.actorId) });
  }

  const filter: Record<string, unknown> =
    conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0]! : { $and: conditions };

  const skip = (query.page - 1) * query.pageSize;
  const [rows, total] = await Promise.all([
    AuditLogModel.find(filter)
      .populate("actorId", "fullName username")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.pageSize)
      .lean(),
    AuditLogModel.countDocuments(filter),
  ]);
  return { rows, meta: { page: query.page, pageSize: query.pageSize, total } };
}

/** Distinct non-auth entity values for transaction history filters. */
export async function listAuditEntityValuesForTransactions(): Promise<string[]> {
  const distinct = (await AuditLogModel.distinct("entity", {
    entity: { $ne: AUDIT_ENTITY_AUTH },
  })) as string[];
  return Array.from(
    new Set(distinct.map((e) => String(e).trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

/** Login history page only ever filters `auth`. */
export function listAuditEntityValuesForLogin(): string[] {
  return [AUDIT_ENTITY_AUTH];
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

function trimUndef(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  const t = String(s).trim();
  return t === "" ? undefined : t;
}

/** Mirrors expense list `expenseDateCondition` / `createdAt` range (same semantics as expense.service). */
function dateFieldCondition(
  field: "expenseDate" | "createdAt",
  from: string | undefined,
  to: string | undefined,
  op: string | undefined,
): Record<string, unknown> | null {
  const f = trimUndef(from);
  const t = trimUndef(to);
  const rawOp = trimUndef(op);
  const effectiveOp = rawOp || (f && t ? "inRange" : f || t ? "equals" : "");

  if (effectiveOp === "inRange" && f && t) {
    const start = ymdStart(f);
    const end = ymdEnd(t);
    if (!start || !end) return null;
    return { [field]: { $gte: start, $lte: end } };
  }
  if (effectiveOp === "equals" && f) {
    const start = ymdStart(f);
    const end = ymdEnd(f);
    if (!start || !end) return null;
    return { [field]: { $gte: start, $lte: end } };
  }
  if (effectiveOp === "before" && f) {
    const start = ymdStart(f);
    if (!start) return null;
    return { [field]: { $lt: start } };
  }
  if (effectiveOp === "after" && f) {
    const end = ymdEnd(f);
    if (!end) return null;
    return { [field]: { $gt: end } };
  }
  if (f && t) {
    const start = ymdStart(f);
    const end = ymdEnd(t);
    if (!start || !end) return null;
    return { [field]: { $gte: start, $lte: end } };
  }
  if (f) {
    const start = ymdStart(f);
    if (!start) return null;
    return { [field]: { $gte: start } };
  }
  if (t) {
    const end = ymdEnd(t);
    if (!end) return null;
    return { [field]: { $lte: end } };
  }
  return null;
}

function parseNum(s: string | undefined): number | null {
  if (s == null) return null;
  const n = parseFloat(String(s).trim());
  return Number.isFinite(n) ? n : null;
}

function amountCondition(
  raw: string | undefined,
  rawTo: string | undefined,
  op: string | undefined,
): Record<string, unknown> | null {
  const a = trimUndef(raw);
  const b = trimUndef(rawTo);
  const rawOp = trimUndef(op);
  const effectiveOp = rawOp || (a && b ? "between" : a ? "equals" : "");

  if (!a && !b) return null;

  if (effectiveOp === "between" && a && b) {
    const x = parseNum(a);
    const y = parseNum(b);
    if (x == null || y == null) return null;
    return { amount: { $gte: Math.min(x, y), $lte: Math.max(x, y) } };
  }
  if (effectiveOp === "equals" && a) {
    const x = parseNum(a);
    if (x == null) return null;
    return { amount: x };
  }
  if (effectiveOp === "notEquals" && a) {
    const x = parseNum(a);
    if (x == null) return null;
    return { amount: { $ne: x } };
  }
  if (effectiveOp === "gt" && a) {
    const x = parseNum(a);
    if (x == null) return null;
    return { amount: { $gt: x } };
  }
  if (effectiveOp === "gte" && a) {
    const x = parseNum(a);
    if (x == null) return null;
    return { amount: { $gte: x } };
  }
  if (effectiveOp === "lt" && a) {
    const x = parseNum(a);
    if (x == null) return null;
    return { amount: { $lt: x } };
  }
  if (effectiveOp === "lte" && a) {
    const x = parseNum(a);
    if (x == null) return null;
    return { amount: { $lte: x } };
  }
  if (a && b) {
    const x = parseNum(a);
    const y = parseNum(b);
    if (x == null || y == null) return null;
    return { amount: { $gte: Math.min(x, y), $lte: Math.max(x, y) } };
  }
  if (a) {
    const x = parseNum(a);
    if (x == null) return null;
    return { amount: x };
  }
  return null;
}

export function buildExpenseReportFilter(q: ExpenseAnalysisFilterQuery): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  const search = trimUndef(q.search);
  if (search) {
    const esc = escapeRegexFragment(search);
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

  const expenseDateCond = dateFieldCondition(
    "expenseDate",
    trimUndef(q.expenseDate_from),
    trimUndef(q.expenseDate_to),
    trimUndef(q.expenseDate_op),
  );
  if (expenseDateCond) conditions.push(expenseDateCond);

  const createdAtCond = dateFieldCondition(
    "createdAt",
    trimUndef(q.createdAt_from),
    trimUndef(q.createdAt_to),
    trimUndef(q.createdAt_op),
  );
  if (createdAtCond) conditions.push(createdAtCond);

  const amtCond = amountCondition(trimUndef(q.amount), trimUndef(q.amount_to), trimUndef(q.amount_op));
  if (amtCond) conditions.push(amtCond);

  const createdBy = trimUndef(q.createdBy);
  if (createdBy && Types.ObjectId.isValid(createdBy)) {
    conditions.push({ createdBy: new Types.ObjectId(createdBy) });
  }

  const approvedBy = trimUndef(q.approvedBy);
  if (approvedBy && Types.ObjectId.isValid(approvedBy)) {
    conditions.push({ approvedBy: new Types.ObjectId(approvedBy) });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0]!;
  return { $and: conditions };
}

export async function getExpenseAnalysisSummary(query: ExpenseAnalysisFilterQuery) {
  const filter = buildExpenseReportFilter(query);

  const [summaryAgg, grandAgg] = await Promise.all([
    ExpenseModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$expenseTypeId",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "expensetypes",
          localField: "_id",
          foreignField: "_id",
          as: "et",
        },
      },
      {
        $project: {
          expenseTypeId: "$_id",
          name: { $arrayElemAt: ["$et.name", 0] },
          totalAmount: 1,
          count: 1,
        },
      },
      { $sort: { name: 1 } },
    ]),
    ExpenseModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          grandTotal: { $sum: "$amount" },
          totalCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const grand = grandAgg[0] ?? { grandTotal: 0, totalCount: 0 };

  return {
    grandTotal: grand.grandTotal ?? 0,
    totalCount: grand.totalCount ?? 0,
    byExpenseType: summaryAgg.map((r) => ({
      expenseTypeId: r.expenseTypeId?.toString?.() ?? String(r._id),
      name: r.name ?? "",
      totalAmount: r.totalAmount ?? 0,
      count: r.count ?? 0,
    })),
  };
}

export async function getExpenseAnalysisRecords(query: ExpenseAnalysisRecordsQuery) {
  const filter = buildExpenseReportFilter(query);
  const page = query.page;
  const pageSize = query.pageSize;
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const [rows, total] = await Promise.all([
    ExpenseModel.find(filter)
      .populate("expenseTypeId", "name code")
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
    meta: { page, pageSize, total },
  };
}

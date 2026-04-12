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

/** Format a Date to YYYY-MM-DD string */
function formatYMD(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Generate an array of YYYY-MM-DD strings between two dates (inclusive) */
function dateRange(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  while (cur <= end) {
    days.push(formatYMD(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export async function getDashboardSummary(query: DateRangeQuery) {
  const { DepositModel } = await import("../deposit/deposit.model");
  const { WithdrawalModel } = await import("../withdrawal/withdrawal.model");

  const dateFilter = buildDateFilter(query);

  /* ── Raw aggregation promises ──────────────────────────────────── */
  const [
    depositAgg,
    withdrawalAgg,
    expenseAgg,
    exchangeStats,
    totalUsers,
    recentDeposits,
    recentWithdrawals,
    depositTrend,
    withdrawalTrend,
  ] = await Promise.all([
    // Deposit: group by status → totalAmount, count, bonusTotal
    DepositModel.aggregate([
      { $match: { ...dateFilter } },
      {
        $group: {
          _id: "$status",
          totalAmount: { $sum: "$amount" },
          bonusTotal: { $sum: { $ifNull: ["$bonusAmount", 0] } },
          count: { $sum: 1 },
        },
      },
    ]),

    // Withdrawal: group by status → totalAmount, payableAmount, count
    WithdrawalModel.aggregate([
      { $match: { ...dateFilter } },
      {
        $group: {
          _id: "$status",
          totalAmount: { $sum: "$amount" },
          payableTotal: { $sum: { $ifNull: ["$payableAmount", 0] } },
          count: { $sum: 1 },
        },
      },
    ]),

    // Expense: group by status
    ExpenseModel.aggregate([
      { $match: { ...dateFilter } },
      {
        $group: {
          _id: "$status",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),

    // Exchange active/total
    Promise.all([
      ExchangeModel.countDocuments({}),
      ExchangeModel.countDocuments({ status: "active" }),
    ]),

    // Total active users
    UserModel.countDocuments({ status: "active" }),

    // Recent deposits (last 10, all statuses)
    DepositModel.find({ ...dateFilter })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("player", "playerId name")
      .populate("createdBy", "fullName username")
      .lean(),

    // Recent withdrawals (last 10, all statuses)
    WithdrawalModel.find({ ...dateFilter })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("player", "playerId name")
      .populate("createdBy", "fullName username")
      .lean(),

    // Deposit daily trend
    DepositModel.aggregate([
      { $match: { ...dateFilter, status: { $ne: "rejected" } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // Withdrawal daily trend
    WithdrawalModel.aggregate([
      { $match: { ...dateFilter, status: { $ne: "rejected" } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  /* ── Aggregate deposit KPIs ────────────────────────────────────── */
  let depositTotal = 0, depositCount = 0, depositPendingCount = 0,
    depositPendingAmount = 0, depositVerifiedAmount = 0, depositVerifiedCount = 0,
    depositRejectedCount = 0, bonusTotal = 0;

  for (const row of depositAgg) {
    depositTotal += row.totalAmount ?? 0;
    depositCount += row.count ?? 0;
    bonusTotal += row.bonusTotal ?? 0;
    if (row._id === "pending") {
      depositPendingCount = row.count ?? 0;
      depositPendingAmount = row.totalAmount ?? 0;
    }
    if (row._id === "verified" || row._id === "finalized") {
      depositVerifiedAmount += row.totalAmount ?? 0;
      depositVerifiedCount += row.count ?? 0;
    }
    if (row._id === "rejected") {
      depositRejectedCount = row.count ?? 0;
    }
  }

  /* ── Aggregate withdrawal KPIs ─────────────────────────────────── */
  let withdrawalTotal = 0, withdrawalCount = 0, withdrawalPendingCount = 0,
    withdrawalPendingAmount = 0, withdrawalFinalizedAmount = 0,
    withdrawalFinalizedCount = 0, withdrawalRejectedCount = 0;

  for (const row of withdrawalAgg) {
    withdrawalTotal += row.totalAmount ?? 0;
    withdrawalCount += row.count ?? 0;
    if (row._id === "requested") {
      withdrawalPendingCount = row.count ?? 0;
      withdrawalPendingAmount = row.totalAmount ?? 0;
    }
    if (row._id === "finalized") {
      withdrawalFinalizedAmount = row.totalAmount ?? 0;
      withdrawalFinalizedCount = row.count ?? 0;
    }
    if (row._id === "rejected") {
      withdrawalRejectedCount = row.count ?? 0;
    }
  }

  /* ── Aggregate expense KPIs ────────────────────────────────────── */
  let expenseTotal = 0, expenseCount = 0, expensePendingCount = 0,
    expenseApprovedAmount = 0;

  for (const row of expenseAgg) {
    expenseTotal += row.totalAmount ?? 0;
    expenseCount += row.count ?? 0;
    if (row._id === "pending_audit") expensePendingCount = row.count ?? 0;
    if (row._id === "approved") expenseApprovedAmount = row.totalAmount ?? 0;
  }

  /* ── P&L calculations ──────────────────────────────────────────── */
  const grossPL = depositVerifiedAmount - withdrawalFinalizedAmount;
  const netPL = grossPL - expenseApprovedAmount;

  /* ── Exchange stats ────────────────────────────────────────────── */
  const [exchangeTotal, exchangeActive] = exchangeStats;

  /* ── Build daily trend (fill missing days with 0) ──────────────── */
  const fromDate = query.fromDate ? new Date(query.fromDate) : (() => { const d = new Date(); d.setDate(d.getDate() - 29); return d; })();
  const toDate = query.toDate ? new Date(query.toDate) : new Date();
  const allDays = dateRange(fromDate, toDate);

  const depositTrendMap = new Map(depositTrend.map((r: { _id: string; totalAmount: number; count: number }) => [r._id, r]));
  const withdrawalTrendMap = new Map(withdrawalTrend.map((r: { _id: string; totalAmount: number; count: number }) => [r._id, r]));

  const trendData = allDays.map((day) => {
    const dep = depositTrendMap.get(day) as { totalAmount: number; count: number } | undefined;
    const wth = withdrawalTrendMap.get(day) as { totalAmount: number; count: number } | undefined;
    return {
      date: day,
      depositAmount: dep?.totalAmount ?? 0,
      depositCount: dep?.count ?? 0,
      withdrawalAmount: wth?.totalAmount ?? 0,
      withdrawalCount: wth?.count ?? 0,
    };
  });

  /* ── Recent activity (merge + sort) ───────────────────────────── */
  type AnyRow = Record<string, unknown>;
  const recentActivity = [
    ...(recentDeposits as unknown as AnyRow[]).map((d) => ({
      _id: String(d._id),
      type: "deposit" as const,
      amount: Number(d.amount ?? 0),
      status: String(d.status ?? ""),
      playerName: (d.player as AnyRow | undefined)?.name ?? d.playerName ?? "",
      createdBy: (d.createdBy as AnyRow | undefined)?.fullName ?? "",
      bankName: String(d.bankName ?? ""),
      utr: String(d.utr ?? ""),
      createdAt: d.createdAt,
    })),
    ...(recentWithdrawals as unknown as AnyRow[]).map((w) => ({
      _id: String(w._id),
      type: "withdrawal" as const,
      amount: Number(w.amount ?? 0),
      status: String(w.status ?? ""),
      playerName: String(w.playerName ?? ""),
      createdBy: (w.createdBy as AnyRow | undefined)?.fullName ?? "",
      bankName: String(w.bankName ?? ""),
      utr: String(w.utr ?? ""),
      createdAt: w.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())
    .slice(0, 20);

  return {
    deposit: {
      totalAmount: depositTotal,
      totalCount: depositCount,
      pendingCount: depositPendingCount,
      pendingAmount: depositPendingAmount,
      verifiedAmount: depositVerifiedAmount,
      verifiedCount: depositVerifiedCount,
      rejectedCount: depositRejectedCount,
      bonusTotal,
    },
    withdrawal: {
      totalAmount: withdrawalTotal,
      totalCount: withdrawalCount,
      pendingCount: withdrawalPendingCount,
      pendingAmount: withdrawalPendingAmount,
      finalizedAmount: withdrawalFinalizedAmount,
      finalizedCount: withdrawalFinalizedCount,
      rejectedCount: withdrawalRejectedCount,
    },
    expense: {
      totalAmount: expenseTotal,
      totalCount: expenseCount,
      pendingCount: expensePendingCount,
      approvedAmount: expenseApprovedAmount,
    },
    pnl: {
      gross: grossPL,
      net: netPL,
    },
    exchanges: {
      total: exchangeTotal,
      active: exchangeActive,
    },
    users: {
      total: totalUsers,
    },
    trendData,
    recentActivity,
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

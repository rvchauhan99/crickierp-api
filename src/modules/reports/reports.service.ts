import { AuditLogModel } from "../audit/audit.model";
import { ExchangeModel } from "../exchange/exchange.model";
import { UserModel } from "../users/user.model";

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

export async function getTransactionHistory(query: DateRangeQuery & { search?: string; page: number; pageSize: number }) {
  const dateFilter = buildDateFilter(query);
  const searchFilter = query.search
    ? {
        $or: [
          { action: { $regex: query.search, $options: "i" } },
          { entity: { $regex: query.search, $options: "i" } },
          { entityId: { $regex: query.search, $options: "i" } },
        ],
      }
    : {};
  const filter = { ...dateFilter, ...searchFilter };
  const skip = (query.page - 1) * query.pageSize;
  const [rows, total] = await Promise.all([
    AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize),
    AuditLogModel.countDocuments(filter),
  ]);
  return { rows, meta: { page: query.page, pageSize: query.pageSize, total } };
}

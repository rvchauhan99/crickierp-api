import { Types } from "mongoose";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { ExchangeModel } from "../exchange/exchange.model";
import { recomputeExchangeCurrentBalance } from "../exchange/exchange.service";
import { ExchangeTopupModel } from "./exchange-topup.model";

export async function createExchangeTopup(
  input: { exchangeId: string; amount: number; remark?: string },
  actorId: string,
  requestId?: string,
) {
  if (!Types.ObjectId.isValid(input.exchangeId)) {
    throw new AppError("validation_error", "Invalid exchange id", 400);
  }
  const exchangeObjectId = new Types.ObjectId(input.exchangeId);
  const exchange = await ExchangeModel.findById(exchangeObjectId).select("_id name provider");
  if (!exchange) throw new AppError("not_found", "Exchange not found", 404);

  const doc = await ExchangeTopupModel.create({
    exchangeId: exchangeObjectId,
    amount: input.amount,
    remark: input.remark?.trim() || undefined,
    createdBy: new Types.ObjectId(actorId),
  });

  const currentBalance = await recomputeExchangeCurrentBalance(exchangeObjectId.toString());

  await createAuditLog({
    actorId,
    action: "exchange.topup_create",
    entity: "exchange_topup",
    entityId: doc._id.toString(),
    newValue: {
      exchangeId: exchangeObjectId.toString(),
      amount: doc.amount,
      remark: doc.remark,
      currentBalance,
    },
    requestId,
  });

  return {
    ...doc.toObject(),
    currentBalance,
  };
}

export async function listExchangeTopups(query: {
  exchangeId?: string;
  page: number;
  pageSize: number;
  sortOrder: "asc" | "desc";
}) {
  const filter: Record<string, unknown> = {};
  if (query.exchangeId) {
    if (!Types.ObjectId.isValid(query.exchangeId)) {
      throw new AppError("validation_error", "Invalid exchange id", 400);
    }
    filter.exchangeId = new Types.ObjectId(query.exchangeId);
  }

  const skip = (query.page - 1) * query.pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const [rows, total] = await Promise.all([
    ExchangeTopupModel.find(filter)
      .populate("exchangeId", "name provider currentBalance openingBalance")
      .populate("createdBy", "fullName username")
      .sort({ createdAt: sortValue })
      .skip(skip)
      .limit(query.pageSize)
      .lean(),
    ExchangeTopupModel.countDocuments(filter),
  ]);

  return {
    rows,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
    },
  };
}

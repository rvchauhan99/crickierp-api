import { Types } from "mongoose";
import { AppError } from "../../shared/errors/AppError";
import { ExchangeModel } from "./exchange.model";

export function isTopLevelExchange(doc: { parentExchange?: Types.ObjectId | null }): boolean {
  return doc.parentExchange == null;
}

export async function countSubExchanges(parentId: Types.ObjectId | string): Promise<number> {
  const id = typeof parentId === "string" ? new Types.ObjectId(parentId) : parentId;
  return ExchangeModel.countDocuments({ parentExchange: id });
}

export async function isGroupExchange(exchangeId: Types.ObjectId | string): Promise<boolean> {
  return (await countSubExchanges(exchangeId)) > 0;
}

export async function listSubExchangeIds(parentId: Types.ObjectId | string): Promise<Types.ObjectId[]> {
  const id = typeof parentId === "string" ? new Types.ObjectId(parentId) : parentId;
  const rows = await ExchangeModel.find({ parentExchange: id }).select("_id").lean();
  return rows.map((r) => r._id);
}

/**
 * Resolve root (top-level) exchange id for a leaf or top-level exchange.
 */
export async function resolveRootExchangeId(exchangeId: Types.ObjectId | string): Promise<Types.ObjectId> {
  const id = typeof exchangeId === "string" ? new Types.ObjectId(exchangeId) : exchangeId;
  const doc = await ExchangeModel.findById(id).select("parentExchange").lean();
  if (!doc) throw new AppError("not_found", "Exchange not found", 404);
  if (doc.parentExchange) return doc.parentExchange as Types.ObjectId;
  return id;
}

/**
 * Assert exchange is assignable to players / top-ups (not a group parent).
 */
export async function assertAssignableExchange(exchangeId: Types.ObjectId | string): Promise<{
  exchangeId: Types.ObjectId;
  rootExchangeId: Types.ObjectId;
  isSub: boolean;
}> {
  const id = typeof exchangeId === "string" ? new Types.ObjectId(exchangeId) : exchangeId;
  const doc = await ExchangeModel.findById(id).select("_id parentExchange").lean();
  if (!doc) throw new AppError("not_found", "Exchange not found", 404);

  if (doc.parentExchange) {
    return {
      exchangeId: id,
      rootExchangeId: doc.parentExchange as Types.ObjectId,
      isSub: true,
    };
  }

  const subCount = await countSubExchanges(id);
  if (subCount > 0) {
    throw new AppError("business_rule_error", "Select a sub exchange", 400);
  }

  return {
    exchangeId: id,
    rootExchangeId: id,
    isSub: false,
  };
}

export async function assertCanBeParent(parentId: Types.ObjectId | string): Promise<void> {
  const id = typeof parentId === "string" ? new Types.ObjectId(parentId) : parentId;
  const parent = await ExchangeModel.findById(id).select("_id parentExchange").lean();
  if (!parent) throw new AppError("not_found", "Parent exchange not found", 404);
  if (parent.parentExchange) {
    throw new AppError("business_rule_error", "Sub exchanges cannot have their own sub exchanges", 400);
  }
}

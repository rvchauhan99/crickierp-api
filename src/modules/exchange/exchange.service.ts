import { Types } from "mongoose";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { ExchangeModel } from "./exchange.model";

type CreateExchangeInput = {
  name: string;
  provider: string;
  openingBalance: number;
  bonus: number;
  status: "active" | "deactive";
};

type ListExchangeQuery = {
  search?: string;
  page: number;
  pageSize: number;
  sortBy: "createdAt" | "name" | "provider";
  sortOrder: "asc" | "desc";
};

export async function createExchange(
  input: CreateExchangeInput,
  actorId: string,
  requestId?: string,
) {
  const exists = await ExchangeModel.findOne({ name: input.name, provider: input.provider });
  if (exists) {
    throw new AppError("business_rule_error", "Exchange already exists for provider", 409);
  }

  const payload = {
    ...input,
    createdBy: new Types.ObjectId(actorId),
    updatedBy: new Types.ObjectId(actorId),
  };
  const doc = await ExchangeModel.create(payload);

  await createAuditLog({
    actorId,
    action: "exchange.create",
    entity: "exchange",
    entityId: doc._id.toString(),
    newValue: {
      name: doc.name,
      provider: doc.provider,
      openingBalance: doc.openingBalance,
      bonus: doc.bonus,
      status: doc.status,
    },
    requestId,
  });

  return doc;
}

export async function listExchanges(query: ListExchangeQuery) {
  const filter = query.search
    ? {
        $or: [
          { name: { $regex: query.search, $options: "i" } },
          { provider: { $regex: query.search, $options: "i" } },
        ],
      }
    : {};

  const skip = (query.page - 1) * query.pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const [rows, total] = await Promise.all([
    ExchangeModel.find(filter).sort({ [query.sortBy]: sortValue }).skip(skip).limit(query.pageSize),
    ExchangeModel.countDocuments(filter),
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

export async function getExchangeById(id: string) {
  const doc = await ExchangeModel.findById(id);
  if (!doc) throw new AppError("not_found", "Exchange not found", 404);
  return doc;
}

export async function updateExchange(
  id: string,
  input: Partial<CreateExchangeInput> & { version: number },
  actorId: string,
  requestId?: string,
) {
  const existing = await ExchangeModel.findById(id);
  if (!existing) throw new AppError("not_found", "Exchange not found", 404);

  if (existing.version !== input.version) {
    throw new AppError("business_rule_error", "Concurrent update conflict", 409);
  }

  const oldValue = {
    name: existing.name,
    provider: existing.provider,
    openingBalance: existing.openingBalance,
    bonus: existing.bonus,
    status: existing.status,
    version: existing.version,
  };

  Object.assign(existing, input);
  existing.updatedBy = new Types.ObjectId(actorId);
  existing.version += 1;
  await existing.save();

  await createAuditLog({
    actorId,
    action: "exchange.update",
    entity: "exchange",
    entityId: existing._id.toString(),
    oldValue,
    newValue: {
      name: existing.name,
      provider: existing.provider,
      openingBalance: existing.openingBalance,
      bonus: existing.bonus,
      status: existing.status,
      version: existing.version,
    },
    requestId,
  });

  return existing;
}

import { Types } from "mongoose";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { WithdrawalModel, WithdrawalStatus } from "./withdrawal.model";

export async function createWithdrawal(input: {
  playerName: string;
  bankName: string;
  utr?: string;
  amount: number;
  stage: "exchange" | "banker" | "final";
}, actorId: string, requestId?: string) {
  const doc = await WithdrawalModel.create({ ...input, createdBy: new Types.ObjectId(actorId), status: "requested" });
  await createAuditLog({
    actorId,
    action: "withdrawal.create",
    entity: "withdrawal",
    entityId: doc._id.toString(),
    newValue: input as unknown as Record<string, unknown>,
    requestId,
  });
  return doc;
}

export async function listWithdrawals(stage: "exchange" | "banker" | "final", query: { page?: number; limit?: number }) {
  const { page = 1, limit = 20 } = query;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    WithdrawalModel.find({ stage }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    WithdrawalModel.countDocuments({ stage }),
  ]);

  return {
    data,
    meta: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    },
  };
}

export async function updateWithdrawalStatus(id: string, status: WithdrawalStatus, actorId: string, requestId?: string) {
  const doc = await WithdrawalModel.findById(id);
  if (!doc) throw new AppError("not_found", "Withdrawal not found", 404);
  const transitions: Record<WithdrawalStatus, WithdrawalStatus[]> = {
    requested: ["approved", "rejected"],
    approved: ["finalized"],
    rejected: [],
    finalized: [],
  };
  if (!transitions[doc.status].includes(status)) {
    throw new AppError("business_rule_error", "Invalid status transition", 400);
  }
  const old = doc.status;
  doc.status = status;
  await doc.save();
  await createAuditLog({
    actorId,
    action: "withdrawal.status_update",
    entity: "withdrawal",
    entityId: doc._id.toString(),
    oldValue: { status: old },
    newValue: { status },
    requestId,
  });
  return doc;
}

import { Types } from "mongoose";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { DepositModel, DepositStatus } from "./deposit.model";

export async function createDeposit(input: {
  bankName: string;
  utr: string;
  amount: number;
  stage: "banker" | "exchange" | "final";
}, actorId: string, requestId?: string) {
  const exists = await DepositModel.findOne({ utr: input.utr });
  if (exists) throw new AppError("business_rule_error", "UTR already exists", 409);
  const doc = await DepositModel.create({ ...input, createdBy: new Types.ObjectId(actorId), status: "pending" });
  await createAuditLog({
    actorId,
    action: "deposit.create",
    entity: "deposit",
    entityId: doc._id.toString(),
    newValue: input as unknown as Record<string, unknown>,
    requestId,
  });
  return doc;
}

export async function listDeposits(stage: "banker" | "exchange" | "final") {
  return DepositModel.find({ stage }).sort({ createdAt: -1 });
}

export async function updateDepositStatus(id: string, status: DepositStatus, actorId: string, requestId?: string) {
  const doc = await DepositModel.findById(id);
  if (!doc) throw new AppError("not_found", "Deposit not found", 404);
  const transitions: Record<DepositStatus, DepositStatus[]> = {
    pending: ["verified", "rejected"],
    verified: ["finalized"],
    finalized: [],
    rejected: [],
  };
  if (!transitions[doc.status].includes(status)) {
    throw new AppError("business_rule_error", "Invalid status transition", 400);
  }
  const old = doc.status;
  doc.status = status;
  await doc.save();
  await createAuditLog({
    actorId,
    action: "deposit.status_update",
    entity: "deposit",
    entityId: doc._id.toString(),
    oldValue: { status: old },
    newValue: { status },
    requestId,
  });
  return doc;
}

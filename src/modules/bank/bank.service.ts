import { Types } from "mongoose";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { BankModel } from "./bank.model";

export async function createBank(input: {
  holderName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  openingBalance: number;
  status: "active" | "deactive";
}, actorId: string, requestId?: string) {
  const existing = await BankModel.findOne({ accountNumber: input.accountNumber });
  if (existing) throw new AppError("business_rule_error", "Account number already exists", 409);
  const doc = await BankModel.create({ ...input, createdBy: new Types.ObjectId(actorId) });
  await createAuditLog({
    actorId,
    action: "bank.create",
    entity: "bank",
    entityId: doc._id.toString(),
    newValue: input as unknown as Record<string, unknown>,
    requestId,
  });
  return doc;
}

export async function listBanks() {
  return BankModel.find({}).sort({ createdAt: -1 });
}

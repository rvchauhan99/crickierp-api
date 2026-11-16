import { Types } from "mongoose";
import { AppError } from "../../shared/errors/AppError";
import { BankModel } from "../bank/bank.model";
import type { DepositStatus } from "./deposit.model";

/** Bank-settlement deposits that count as cash already in the bank (exclude rejected). */
export const DEPOSIT_BANK_CASH_STATUSES: readonly DepositStatus[] = [
  "pending",
  "not_settled",
  "verified",
  "finalized",
] as const;

/** Statuses that still need a go-live balance backfill (verified/finalized already credited under the old approve path). */
export const DEPOSIT_BANK_CASH_BACKFILL_STATUSES: readonly DepositStatus[] = [
  "pending",
  "not_settled",
] as const;

export function depositBankCashMongoFilter(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: { $in: [...DEPOSIT_BANK_CASH_STATUSES] },
    bankImpact: { $ne: false },
    ...extra,
  };
}

/** Apply signed delta to Bank.currentBalance; returns balance after. */
export async function applyBankCashDelta(
  bankId: Types.ObjectId | string,
  delta: number,
): Promise<number> {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-12) {
    const bank = await BankModel.findById(bankId).select("currentBalance openingBalance").lean();
    if (!bank) throw new AppError("not_found", "Bank not found", 404);
    return Number(bank.currentBalance ?? bank.openingBalance ?? 0);
  }
  const bank = await BankModel.findById(bankId);
  if (!bank) throw new AppError("not_found", "Bank not found", 404);
  const prev = Number(bank.currentBalance ?? bank.openingBalance ?? 0);
  const next = prev + delta;
  bank.currentBalance = next;
  await bank.save();
  return next;
}

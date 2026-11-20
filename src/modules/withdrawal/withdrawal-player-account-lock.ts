import { Types } from "mongoose";
import { env, type WithdrawalPlayerAccountLockMode } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import { escapeRegex } from "../../shared/utils/utr";
import { WithdrawalModel } from "./withdrawal.model";

export function withdrawalBeneficiaryAccountKey(accountNumber: string, ifsc: string): string {
  return `${String(accountNumber ?? "").trim()}|${String(ifsc ?? "").trim().toUpperCase()}`;
}

export function getWithdrawalPlayerAccountLockMode(): WithdrawalPlayerAccountLockMode {
  return env.withdrawalPlayerAccountLockMode;
}

/**
 * ENV-gated unique player↔beneficiary account rule.
 * Lock corpus: status != rejected (same idea as UTR uniqueness).
 */
export async function assertWithdrawalPlayerAccountLock(input: {
  playerId: string;
  accountNumber: string;
  ifsc: string;
  excludeWithdrawalId?: Types.ObjectId | string;
}): Promise<void> {
  const mode = env.withdrawalPlayerAccountLockMode;
  if (mode === "off") return;

  const playerId = String(input.playerId ?? "").trim();
  if (!Types.ObjectId.isValid(playerId)) {
    throw new AppError("validation_error", "Invalid player id", 400);
  }
  const accountNumber = String(input.accountNumber ?? "").trim();
  const ifsc = String(input.ifsc ?? "").trim();
  if (!accountNumber || !ifsc) {
    throw new AppError("validation_error", "Account number and IFSC are required", 400);
  }

  const playerOid = new Types.ObjectId(playerId);
  const accountKey = withdrawalBeneficiaryAccountKey(accountNumber, ifsc);
  const excludeOid =
    input.excludeWithdrawalId && Types.ObjectId.isValid(String(input.excludeWithdrawalId))
      ? new Types.ObjectId(String(input.excludeWithdrawalId))
      : undefined;

  const baseFilter: Record<string, unknown> = {
    status: { $ne: "rejected" },
  };
  if (excludeOid) {
    baseFilter._id = { $ne: excludeOid };
  }

  const accountOwnerConflict = await WithdrawalModel.findOne({
    ...baseFilter,
    accountNumber,
    ifsc: { $regex: `^${escapeRegex(ifsc)}$`, $options: "i" },
    player: { $ne: playerOid },
  })
    .select({ _id: 1 })
    .lean();
  if (accountOwnerConflict) {
    throw new AppError(
      "business_rule_error",
      "This bank account is already linked to another player.",
      400,
    );
  }

  if (mode !== "strict_1to1") return;

  // Canonical lock = earliest non-rejected beneficiary account for this player.
  const playerRows = await WithdrawalModel.find({
    ...baseFilter,
    player: playerOid,
    accountNumber: { $nin: [null, ""] },
  })
    .select({ accountNumber: 1, ifsc: 1, requestedAt: 1, createdAt: 1 })
    .sort({ requestedAt: 1, createdAt: 1, _id: 1 })
    .limit(50)
    .lean();

  let lockedKey = "";
  for (const row of playerRows) {
    const existingKey = withdrawalBeneficiaryAccountKey(
      String(row.accountNumber ?? ""),
      String(row.ifsc ?? ""),
    );
    if (!existingKey.startsWith("|")) {
      lockedKey = existingKey;
      break;
    }
  }

  if (lockedKey && lockedKey !== accountKey) {
    throw new AppError(
      "business_rule_error",
      "This player is already locked to a different withdrawal account.",
      400,
    );
  }
}

export async function validateWithdrawalPlayerAccount(input: {
  playerId: string;
  accountNumber: string;
  ifsc: string;
  excludeWithdrawalId?: string;
}): Promise<{ ok: true }> {
  await assertWithdrawalPlayerAccountLock({
    playerId: input.playerId,
    accountNumber: input.accountNumber,
    ifsc: input.ifsc,
    excludeWithdrawalId: input.excludeWithdrawalId,
  });
  return { ok: true };
}

import { env } from "../../config/env";
import { isSuperadminRole } from "../middlewares/permissionAccess";

/** Deposit business datetime: entryAt falling back to createdAt. */
export const DEPOSIT_TX_EXPR = { $ifNull: ["$entryAt", "$createdAt"] };

/** Withdrawal business datetime: requestedAt falling back to createdAt. */
export const WITHDRAWAL_TX_EXPR = { $ifNull: ["$requestedAt", "$createdAt"] };

/**
 * For non-superadmin actors, AND a lookback window onto the list/export filter.
 * Superadmin (or lookbackHours <= 0) leaves the filter unchanged.
 * User date filters cannot widen past this window.
 */
export function applyNonSuperadminTxnLookback(
  filter: Record<string, unknown>,
  actorRole: string | undefined,
  txExpr: Record<string, unknown>,
): Record<string, unknown> {
  const hours = env.depositWithdrawalLookbackHours;
  if (isSuperadminRole(actorRole) || !Number.isFinite(hours) || hours <= 0) {
    return filter;
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const lookbackCond: Record<string, unknown> = {
    $expr: { $gte: [txExpr, since] },
  };

  if (Object.keys(filter).length === 0) {
    return lookbackCond;
  }
  return { $and: [filter, lookbackCond] };
}

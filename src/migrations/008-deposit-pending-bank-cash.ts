/**
 * Backfill Bank.currentBalance for existing pending/not_settled bank-impact deposits.
 * Verified/finalized were already credited under the old approve-time path — do not touch them.
 */
import type { Db } from "mongodb";
import { logger } from "../shared/logger";

const DEPOSITS = "deposits";
const BANKS = "banks";

export const migration008DepositPendingBankCash = {
  id: "008_deposit_pending_bank_cash" as const,

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
    if (!existing.has(DEPOSITS) || !existing.has(BANKS)) {
      logger.info(
        { migrationId: migration008DepositPendingBankCash.id },
        "deposits/banks collection missing; skipping",
      );
      return;
    }

    const rows = await db
      .collection(DEPOSITS)
      .aggregate<{ _id: unknown; total: number; count: number }>([
        {
          $match: {
            status: { $in: ["pending", "not_settled"] },
            bankImpact: { $ne: false },
            bankId: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: "$bankId",
            total: { $sum: { $ifNull: ["$amount", 0] } },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    let updated = 0;
    for (const row of rows) {
      const amount = Number(row.total ?? 0);
      if (!row._id || !Number.isFinite(amount) || amount === 0) continue;
      const res = await db.collection(BANKS).updateOne(
        { _id: row._id },
        { $inc: { currentBalance: amount } },
      );
      if (res.modifiedCount > 0) updated += 1;
    }

    logger.info(
      {
        migrationId: migration008DepositPendingBankCash.id,
        banksTouched: updated,
        groups: rows.length,
      },
      "deposit pending bank cash backfill summary",
    );
  },
};

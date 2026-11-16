/**
 * Runs once on deploy (server.ts → runMigrations).
 * Backfills ExchangeTopup.entryType = "credit" for legacy rows missing the field.
 */
import type { Db } from "mongodb";
import { logger } from "../shared/logger";

const COLLECTION = "exchangetopups";

export const migration007ExchangeTopupEntryType = {
  id: "007_exchange_topup_entry_type" as const,

  async up(db: Db): Promise<void> {
    const existingCollections = new Set((await db.listCollections().toArray()).map((c) => c.name));

    if (!existingCollections.has(COLLECTION)) {
      logger.info(
        { migrationId: migration007ExchangeTopupEntryType.id },
        "exchangetopups collection not found; skipping migration",
      );
      return;
    }

    const result = await db.collection(COLLECTION).updateMany(
      { $or: [{ entryType: { $exists: false } }, { entryType: null }] },
      { $set: { entryType: "credit" } },
    );

    logger.info(
      {
        migrationId: migration007ExchangeTopupEntryType.id,
        matched: result.matchedCount,
        modified: result.modifiedCount,
      },
      "backfilled exchange topup entryType=credit",
    );
  },
};

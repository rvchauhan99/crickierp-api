/**
 * Runs once on deploy (server.ts → runMigrations).
 * Backfills player.rootExchange, swaps legacy unique indexes, syncs exchange balances for rollup.
 * Later deploys: "migration skipped (already applied)" for id 006_sub_exchange_root_and_indexes.
 */
import type { Db } from "mongodb";
import { logger } from "../shared/logger";
import { ExchangeModel } from "../modules/exchange/exchange.model";
import { PlayerModel } from "../modules/player/player.model";
import { syncAllExchangeCurrentBalances } from "../shared/services/exchange-balance.service";

const PLAYERS_COLLECTION = "players";
const EXCHANGES_COLLECTION = "exchanges";

function indexErrorCode(err: unknown): number | undefined {
  return err && typeof err === "object" && "code" in err ? (err as { code?: number }).code : undefined;
}

export const migration006SubExchangeRootAndIndexes = {
  id: "006_sub_exchange_root_and_indexes" as const,

  async up(db: Db): Promise<void> {
    const existingCollections = new Set((await db.listCollections().toArray()).map((c) => c.name));

    if (!existingCollections.has(PLAYERS_COLLECTION) && !existingCollections.has(EXCHANGES_COLLECTION)) {
      logger.info(
        { migrationId: migration006SubExchangeRootAndIndexes.id },
        "players/exchanges collections not found; skipping migration",
      );
      return;
    }

    let backfillMatched = 0;
    let backfillModified = 0;
    if (existingCollections.has(PLAYERS_COLLECTION)) {
      const backfill = await db.collection(PLAYERS_COLLECTION).updateMany(
        { $or: [{ rootExchange: { $exists: false } }, { rootExchange: null }] },
        [{ $set: { rootExchange: "$exchange" } }],
      );
      backfillMatched = backfill.matchedCount;
      backfillModified = backfill.modifiedCount;

      try {
        await PlayerModel.collection.dropIndex("exchange_1_playerId_1");
        logger.info(
          { migrationId: migration006SubExchangeRootAndIndexes.id },
          "dropped legacy unique index exchange_1_playerId_1",
        );
      } catch (err: unknown) {
        if (indexErrorCode(err) === 27) {
          logger.info(
            { migrationId: migration006SubExchangeRootAndIndexes.id },
            "legacy index exchange_1_playerId_1 already absent",
          );
        } else {
          logger.warn(
            { err, migrationId: migration006SubExchangeRootAndIndexes.id },
            "drop exchange_1_playerId_1 skipped or failed",
          );
        }
      }

      await PlayerModel.syncIndexes();
    }

    if (existingCollections.has(EXCHANGES_COLLECTION)) {
      try {
        await ExchangeModel.collection.dropIndex("name_1_provider_1");
        logger.info(
          { migrationId: migration006SubExchangeRootAndIndexes.id },
          "dropped legacy unique index name_1_provider_1",
        );
      } catch (err: unknown) {
        if (indexErrorCode(err) === 27) {
          logger.info(
            { migrationId: migration006SubExchangeRootAndIndexes.id },
            "legacy index name_1_provider_1 already absent",
          );
        } else {
          logger.warn(
            { err, migrationId: migration006SubExchangeRootAndIndexes.id },
            "drop name_1_provider_1 skipped or failed",
          );
        }
      }

      await ExchangeModel.syncIndexes();
    }

    let sync = { total: 0, updated: 0, unchanged: 0 };
    if (existingCollections.has(EXCHANGES_COLLECTION)) {
      sync = await syncAllExchangeCurrentBalances({ apply: true });
    }

    logger.info(
      {
        migrationId: migration006SubExchangeRootAndIndexes.id,
        backfillMatched,
        backfillModified,
        total: sync.total,
        updated: sync.updated,
        unchanged: sync.unchanged,
      },
      "sub-exchange rootExchange and indexes migration summary",
    );
  },
};

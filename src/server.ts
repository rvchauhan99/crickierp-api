import "dotenv/config";
import { createApp } from "./app";
import { env } from "./config/env";
import { connectDb } from "./shared/db/connect";
import { bootstrapData } from "./shared/db/bootstrap";
import { runMigrations } from "./migrations";
import { logger } from "./shared/logger";
import { startPlayerImportWorker, stopPlayerImportWorker } from "./modules/player/player-import-job.service";
import { startQueueWorkers, stopQueueWorkers } from "./shared/queue/queue";

async function start() {
  await connectDb();
  await runMigrations();
  await bootstrapData();

  const app = createApp();
  startPlayerImportWorker();
  startQueueWorkers();
  app.listen(env.port, () => {
    logger.info(`API server running on port ${env.port}`);
  });
}

start().catch((error) => {
  logger.error(error);
  stopPlayerImportWorker();
  void stopQueueWorkers();
  process.exit(1);
});

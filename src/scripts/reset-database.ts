import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "../shared/db/connect";
import { bootstrapData } from "../shared/db/bootstrap";
import { logger } from "../shared/logger";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Database reset is refused when NODE_ENV=production");
  }

  await connectDb();
  const dbName = mongoose.connection.db?.databaseName;
  await mongoose.connection.dropDatabase();
  logger.info({ dbName }, "Dropped database");
  await bootstrapData();
  logger.info(
    "Seeded permissions and superadmin — username: superadmin, password: SuperAdmin@123",
  );
  await mongoose.disconnect();
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});

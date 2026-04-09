import mongoose from "mongoose";
import { env } from "../../config/env";
import { logger } from "../logger";

export async function connectDb() {
  await mongoose.connect(env.mongoUri);
  logger.info("MongoDB connected");
}

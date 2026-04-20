import mongoose from "mongoose";
import { env } from "../../config/env";
import { logger } from "../logger";

export async function connectDb() {
  console.log("env.mongoUrimongoUrimongoUrimongoUrimongoUri", env.mongoUri);
  // console.log("env.mongoUri", env.mongoUri);
  await mongoose.connect(env.mongoUri);
  logger.info("MongoDB connected");
}

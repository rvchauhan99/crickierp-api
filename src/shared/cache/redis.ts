import IORedis from "ioredis";
import { env } from "../../config/env";
import { logger } from "../logger";

let redisClient: IORedis | null = null;

export function getRedisClient(): IORedis | null {
  if (!env.redisUrl) return null;
  if (!redisClient) {
    redisClient = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    redisClient.on("error", (err) => {
      logger.warn({ err }, "Redis client error");
    });
  }
  return redisClient;
}

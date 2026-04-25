import IORedis from "ioredis";
import { env } from "../../config/env";
import { logger } from "../logger";

let redisClient: IORedis | null = null;
let redisQueueClient: IORedis | null = null;

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

export function getRedisQueueClient(): IORedis | null {
  if (!env.redisUrl) return null;
  if (!redisQueueClient) {
    redisQueueClient = new IORedis(env.redisUrl, {
      // BullMQ requires this for blocking commands used by workers.
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    redisQueueClient.on("error", (err) => {
      logger.warn({ err }, "Redis queue client error");
    });
  }
  return redisQueueClient;
}

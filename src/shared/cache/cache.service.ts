import { getRedisClient } from "./redis";

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  await redis.connect().catch(() => undefined);
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCachedJson(key: string, data: unknown, ttlSeconds: number): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  await redis.connect().catch(() => undefined);
  await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
}

export async function bumpCacheVersion(namespace: string): Promise<number> {
  const redis = getRedisClient();
  if (!redis) return 1;
  await redis.connect().catch(() => undefined);
  const key = `cache:version:${namespace}`;
  const next = await redis.incr(key);
  if (next === 1) {
    await redis.expire(key, 60 * 60 * 24 * 30);
  }
  return next;
}

export async function getCacheVersion(namespace: string): Promise<number> {
  const redis = getRedisClient();
  if (!redis) return 1;
  await redis.connect().catch(() => undefined);
  const key = `cache:version:${namespace}`;
  const value = await redis.get(key);
  if (!value) return 1;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

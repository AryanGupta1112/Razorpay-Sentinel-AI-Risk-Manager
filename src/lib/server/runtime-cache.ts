import "server-only";

import { createClient } from "redis";

const REDIS_URL = process.env.SENTINEL_REDIS_URL?.trim() || process.env.REDIS_URL?.trim() || "";
type SentinelRedisClient = ReturnType<typeof createClient>;

declare global {
  var __sentinelRedis: SentinelRedisClient | undefined;
  var __sentinelRedisConnectPromise: Promise<SentinelRedisClient | null> | undefined;
  var __sentinelMemoryCache:
    | Map<string, { expiresAt: number; value: string }>
    | undefined;
}

function memoryStore() {
  if (!global.__sentinelMemoryCache) {
    global.__sentinelMemoryCache = new Map();
  }

  return global.__sentinelMemoryCache;
}

function pruneMemoryCache() {
  const now = Date.now();
  for (const [key, entry] of memoryStore()) {
    if (entry.expiresAt <= now) {
      memoryStore().delete(key);
    }
  }
}

async function getRedisClient() {
  if (!REDIS_URL) {
    return null;
  }

  if (global.__sentinelRedis?.isOpen) {
    return global.__sentinelRedis;
  }

  if (!global.__sentinelRedisConnectPromise) {
    const client = createClient({ url: REDIS_URL });
    client.on("error", () => {
      // fall back to in-memory cache when Redis is unavailable
    });
    global.__sentinelRedis = client;
    global.__sentinelRedisConnectPromise = client
      .connect()
      .then(() => client)
      .catch(() => null)
      .finally(() => {
        global.__sentinelRedisConnectPromise = undefined;
      });
  }

  return global.__sentinelRedisConnectPromise;
}

export async function readCachedJson<T>(key: string): Promise<T | null> {
  const redis = await getRedisClient();
  if (redis?.isOpen) {
    const value = await redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  pruneMemoryCache();
  const entry = memoryStore().get(key);
  if (!entry) return null;
  return JSON.parse(entry.value) as T;
}

export async function writeCachedJson(key: string, value: unknown, ttlSeconds: number) {
  const payload = JSON.stringify(value);
  const redis = await getRedisClient();

  if (redis?.isOpen) {
    await redis.set(key, payload, { EX: ttlSeconds });
    return;
  }

  memoryStore().set(key, {
    value: payload,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function deleteCachedKeys(keys: string[]) {
  if (keys.length === 0) return;

  const redis = await getRedisClient();
  if (redis?.isOpen) {
    await redis.del(keys);
  }

  for (const key of keys) {
    memoryStore().delete(key);
  }
}

export async function deleteCachedByPrefix(prefix: string) {
  if (!prefix) return;

  const redis = await getRedisClient();
  if (redis?.isOpen) {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  }

  for (const key of Array.from(memoryStore().keys())) {
    if (key.startsWith(prefix)) {
      memoryStore().delete(key);
    }
  }
}

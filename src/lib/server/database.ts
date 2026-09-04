import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

const DATABASE_URL = process.env.SENTINEL_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";

declare global {
  var __sentinelPgPool: Pool | undefined;
}

function createPool() {
  return new Pool({
    connectionString: DATABASE_URL,
    max: Number(process.env.SENTINEL_DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.SENTINEL_DATABASE_IDLE_MS || 30_000),
    connectionTimeoutMillis: Number(process.env.SENTINEL_DATABASE_CONNECT_MS || 5_000),
  });
}

export function hasDatabaseUrl() {
  return DATABASE_URL.length > 0;
}

function getDatabasePool() {
  if (!hasDatabaseUrl()) {
    throw new Error("SENTINEL_DATABASE_URL or DATABASE_URL is not configured.");
  }

  if (!global.__sentinelPgPool) {
    global.__sentinelPgPool = createPool();
  }

  return global.__sentinelPgPool;
}

export async function queryDb<T extends QueryResultRow = QueryResultRow>(
  query: string,
  params?: unknown[],
) {
  return getDatabasePool().query<T>(query, params);
}

export async function withDatabaseTransaction<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await getDatabasePool().connect();

  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

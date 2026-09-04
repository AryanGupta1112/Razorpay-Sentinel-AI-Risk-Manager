import assert from "node:assert/strict";
import test from "node:test";
import { getDatabasePoolOptions } from "./database-options.ts";

test("uses a small fail-fast pool in Vercel functions", () => {
  assert.deepEqual(getDatabasePoolOptions({ VERCEL: "1" }), {
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 2_500,
    allowExitOnIdle: true,
    keepAlive: true,
  });
});

test("keeps development pool defaults outside serverless runtimes", () => {
  assert.deepEqual(getDatabasePoolOptions({}), {
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
    keepAlive: true,
  });
});

test("accepts positive deployment overrides and rejects invalid values", () => {
  assert.deepEqual(
    getDatabasePoolOptions({
      VERCEL: "1",
      SENTINEL_DATABASE_POOL_MAX: "2",
      SENTINEL_DATABASE_IDLE_MS: "8000",
      SENTINEL_DATABASE_CONNECT_MS: "30000",
    }),
    {
      max: 2,
      idleTimeoutMillis: 8_000,
      connectionTimeoutMillis: 2_500,
      allowExitOnIdle: true,
      keepAlive: true,
    },
  );

  assert.equal(getDatabasePoolOptions({ VERCEL: "1", SENTINEL_DATABASE_POOL_MAX: "0" }).max, 1);
});

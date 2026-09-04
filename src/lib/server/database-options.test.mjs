import assert from "node:assert/strict";
import test from "node:test";
import { getDatabasePoolOptions } from "./database-options.ts";

test("uses local development pool defaults", () => {
  assert.deepEqual(getDatabasePoolOptions({}), {
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
    keepAlive: true,
  });
});

test("accepts positive local overrides and rejects invalid values", () => {
  assert.deepEqual(
    getDatabasePoolOptions({
      SENTINEL_DATABASE_POOL_MAX: "2",
      SENTINEL_DATABASE_IDLE_MS: "8000",
      SENTINEL_DATABASE_CONNECT_MS: "30000",
    }),
    {
      max: 2,
      idleTimeoutMillis: 8_000,
      connectionTimeoutMillis: 30_000,
      allowExitOnIdle: false,
      keepAlive: true,
    },
  );

  assert.equal(getDatabasePoolOptions({ SENTINEL_DATABASE_POOL_MAX: "0" }).max, 10);
});

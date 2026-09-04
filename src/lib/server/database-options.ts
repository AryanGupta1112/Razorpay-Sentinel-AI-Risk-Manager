type DatabaseEnvironment = {
  SENTINEL_DATABASE_POOL_MAX?: string;
  SENTINEL_DATABASE_IDLE_MS?: string;
  SENTINEL_DATABASE_CONNECT_MS?: string;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getDatabasePoolOptions(
  environment: DatabaseEnvironment | NodeJS.ProcessEnv = process.env,
) {
  return {
    max: positiveInteger(environment.SENTINEL_DATABASE_POOL_MAX, 10),
    idleTimeoutMillis: positiveInteger(environment.SENTINEL_DATABASE_IDLE_MS, 30_000),
    connectionTimeoutMillis: positiveInteger(environment.SENTINEL_DATABASE_CONNECT_MS, 5_000),
    allowExitOnIdle: false,
    keepAlive: true,
  };
}

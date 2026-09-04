type DatabaseEnvironment = {
  VERCEL?: string;
  SENTINEL_DATABASE_POOL_MAX?: string;
  SENTINEL_DATABASE_IDLE_MS?: string;
  SENTINEL_DATABASE_CONNECT_MS?: string;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cappedPositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  return Math.min(positiveInteger(value, fallback), maximum);
}

export function getDatabasePoolOptions(
  environment: DatabaseEnvironment | NodeJS.ProcessEnv = process.env,
) {
  const isServerless = environment.VERCEL === "1";

  return {
    max: positiveInteger(environment.SENTINEL_DATABASE_POOL_MAX, isServerless ? 1 : 10),
    idleTimeoutMillis: positiveInteger(
      environment.SENTINEL_DATABASE_IDLE_MS,
      isServerless ? 5_000 : 30_000,
    ),
    connectionTimeoutMillis: isServerless
      ? cappedPositiveInteger(environment.SENTINEL_DATABASE_CONNECT_MS, 2_500, 2_500)
      : positiveInteger(environment.SENTINEL_DATABASE_CONNECT_MS, 5_000),
    allowExitOnIdle: isServerless,
    keepAlive: true,
  };
}

type OperationalReadOptions<T> = {
  readPrimary: () => Promise<T>;
  readFallback: () => T | Promise<T>;
  allowDegradedFallback: boolean;
  fallbackAfterMs?: number;
};

class OperationalReadDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`Operational read exceeded ${timeoutMs}ms.`);
    this.name = "OperationalReadDeadlineError";
  }
}

async function readBeforeDeadline<T>(readPrimary: () => Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      readPrimary(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OperationalReadDeadlineError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readOperationalData<T>({
  readPrimary,
  readFallback,
  allowDegradedFallback,
  fallbackAfterMs,
}: OperationalReadOptions<T>): Promise<T> {
  try {
    return allowDegradedFallback && fallbackAfterMs
      ? await readBeforeDeadline(readPrimary, fallbackAfterMs)
      : await readPrimary();
  } catch (error) {
    if (!allowDegradedFallback) throw error;
    return readFallback();
  }
}

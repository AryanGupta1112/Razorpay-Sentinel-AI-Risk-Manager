type OperationalReadOptions<T> = {
  readPrimary: () => Promise<T>;
  readFallback: () => T | Promise<T>;
  allowDegradedFallback: boolean;
};

export async function readOperationalData<T>({
  readPrimary,
  readFallback,
  allowDegradedFallback,
}: OperationalReadOptions<T>): Promise<T> {
  try {
    return await readPrimary();
  } catch (error) {
    if (!allowDegradedFallback) throw error;
    return readFallback();
  }
}

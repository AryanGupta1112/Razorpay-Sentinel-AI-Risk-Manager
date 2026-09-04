import path from "node:path";

export function getRuntimeStoreDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
) {
  const configuredDirectory = environment.SENTINEL_RUNTIME_DIR?.trim();
  if (configuredDirectory) {
    return path.resolve(workingDirectory, configuredDirectory);
  }

  return path.join(workingDirectory, ".runtime");
}

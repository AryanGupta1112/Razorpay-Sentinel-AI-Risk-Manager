import os from "node:os";
import path from "node:path";

export function isVercelRuntime(environment: NodeJS.ProcessEnv = process.env) {
  return environment.VERCEL === "1";
}

export function allowsFileStoreFallback(environment: NodeJS.ProcessEnv = process.env) {
  return !isVercelRuntime(environment) || environment.SENTINEL_ALLOW_FILE_FALLBACK === "true";
}

export function getRuntimeStoreDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
  temporaryDirectory = os.tmpdir(),
) {
  const configuredDirectory = environment.SENTINEL_RUNTIME_DIR?.trim();
  if (configuredDirectory) {
    return path.resolve(workingDirectory, configuredDirectory);
  }

  if (isVercelRuntime(environment)) {
    return path.join(temporaryDirectory, "sentinel-runtime");
  }

  return path.join(workingDirectory, ".runtime");
}

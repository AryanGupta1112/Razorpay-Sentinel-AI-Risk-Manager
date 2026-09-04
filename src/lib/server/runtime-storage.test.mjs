import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  allowsFileStoreFallback,
  getRuntimeStoreDirectory,
} from "./runtime-storage.ts";

test("uses a writable temporary directory on Vercel", () => {
  assert.equal(
    getRuntimeStoreDirectory({ VERCEL: "1" }, "/var/task", "/tmp"),
    path.join("/tmp", "sentinel-runtime"),
  );
});

test("disables ephemeral file fallback on Vercel by default", () => {
  assert.equal(allowsFileStoreFallback({ VERCEL: "1" }), false);
  assert.equal(
    allowsFileStoreFallback({ VERCEL: "1", SENTINEL_ALLOW_FILE_FALLBACK: "true" }),
    true,
  );
});

test("preserves the local development store", () => {
  assert.equal(
    getRuntimeStoreDirectory({}, "C:\\project", "C:\\temp"),
    path.join("C:\\project", ".runtime"),
  );
  assert.equal(allowsFileStoreFallback({}), true);
});

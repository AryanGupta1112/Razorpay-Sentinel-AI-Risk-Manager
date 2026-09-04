import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { getRuntimeStoreDirectory } from "./runtime-storage.ts";

test("preserves the local development store", () => {
  assert.equal(
    getRuntimeStoreDirectory({}, "C:\\project"),
    path.join("C:\\project", ".runtime"),
  );
});

test("honors a configured local runtime directory", () => {
  assert.equal(
    getRuntimeStoreDirectory({ SENTINEL_RUNTIME_DIR: "var/sentinel" }, "/project"),
    path.resolve("/project", "var/sentinel"),
  );
});

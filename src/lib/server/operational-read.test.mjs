import assert from "node:assert/strict";
import test from "node:test";
import { readOperationalData } from "./operational-read.ts";

test("returns degraded data when an explicitly resilient read fails", async () => {
  const fallback = { source: "generated" };
  const result = await readOperationalData({
    readPrimary: async () => {
      throw new Error("database unavailable");
    },
    readFallback: () => fallback,
    allowDegradedFallback: true,
  });

  assert.equal(result, fallback);
});

test("keeps strict operational reads strict", async () => {
  await assert.rejects(
    readOperationalData({
      readPrimary: async () => {
        throw new Error("database unavailable");
      },
      readFallback: () => ({ source: "generated" }),
      allowDegradedFallback: false,
    }),
    /database unavailable/,
  );
});

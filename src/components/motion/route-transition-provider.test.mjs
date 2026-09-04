import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("console entry content remains visible if CSS animation startup is interrupted", async () => {
  const css = await readFile(new URL("./route-transition-provider.module.css", import.meta.url), "utf8");
  const entryLoaderRule = css.match(/\.entryLoader\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

  assert.match(entryLoaderRule, /opacity:\s*1\s*;/);
  assert.match(entryLoaderRule, /z-index:\s*[1-9]\d*\s*;/);
});

test("route transitions include a watchdog that releases a stalled overlay", async () => {
  const source = await readFile(new URL("./route-transition-provider.tsx", import.meta.url), "utf8");

  assert.match(source, /transitionSafetyTimerRef/);
  assert.match(source, /CONSOLE_ENTRY_MAXIMUM_MS/);
});

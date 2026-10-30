import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
test("PostgreSQL preserves concurrent patches, import history, and idempotent manual logs", () => {
  const result = Bun.spawnSync([
    process.execPath,
    fileURLToPath(new URL("./persistence-check.ts", import.meta.url)),
  ]);
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
}, 30000);

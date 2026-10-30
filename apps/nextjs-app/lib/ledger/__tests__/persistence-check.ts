import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { ledgerRecords, sessions, items, servers } from "@streamystats/database";
mock.module("server-only", () => ({}));
const postgres = new PGlite();
await postgres.exec(
  "CREATE TABLE servers(id integer PRIMARY KEY, timezone text DEFAULT 'UTC'); CREATE TABLE users(id text PRIMARY KEY); INSERT INTO servers VALUES(1); INSERT INTO users VALUES('viewer'),('other');",
);
await postgres.exec(
  await readFile(
    new URL(
      "../../../../../packages/database/drizzle/0045_abnormal_war_machine.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const database = drizzle(postgres);
mock.module("@streamystats/database", () => ({
  db: database,
  ledgerRecords,
  sessions,
  items,
  servers,
}));
const { saveLedgerRows, resetLedgerCorrections } = await import("../persistence");
const scope = { serverId: 1, userId: "viewer" };
const read = async (kind: string) =>
  (
    await postgres.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM ledger_records WHERE server_id=1 AND user_id='viewer' AND kind=$1",
      [kind],
    )
  ).rows;
for (const kind of ["correction", "settings"]) {
  await Promise.all([
    saveLedgerRows({ ...scope, rows: [{ kind, sourceKey: "key", payload: { a: true } }] }),
    saveLedgerRows({ ...scope, rows: [{ kind, sourceKey: "key", payload: { b: true } }] }),
  ]);
  assert.deepEqual((await read(kind))[0].payload, { a: true, b: true });
}
const newer = {
  kind: "simkl-json",
  sourceKey: "show",
  payload: {
    history: [
      { key: "ep1", watchedAt: "2026-10-02T00:00:00.123456Z" },
      { key: "ep2", watchedAt: "2026-10-03T00:00:00.000000Z" },
    ],
  },
};
await saveLedgerRows({ ...scope, rows: [newer] });
await saveLedgerRows({
  ...scope,
  rows: [
    { ...newer, payload: { history: [{ key: "ep1", watchedAt: "2026-10-01T00:00:00.000000Z" }] } },
  ],
});
assert.deepEqual((await read("simkl-json"))[0].payload.history, newer.payload.history);
const manual = {
  kind: "manual",
  sourceKey: "stable-request",
  payload: { source: "manual", runtime: 100, completed: true },
};
await saveLedgerRows({ ...scope, rows: [manual] });
await saveLedgerRows({
  ...scope,
  rows: [{ ...manual, payload: { completed: true, runtime: 100, source: "manual" } }],
});
assert.equal((await read("manual")).length, 1);
await assert.rejects(
  saveLedgerRows({ ...scope, rows: [{ ...manual, payload: { ...manual.payload, runtime: 200 } }] }),
);
assert.equal((await read("manual"))[0].payload.runtime, 100);
await saveLedgerRows({ serverId: 1, userId: "other", rows: [manual] });
assert.equal((await read("manual")).length, 1);
await resetLedgerCorrections({ ...scope, key: "key" });
assert.equal((await read("correction")).length, 0);
mock.module("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
mock.module("@/lib/db/exclusions", () => ({
  getStatisticsExclusions: async () => ({ excludedUserIds: [] }),
}));
await postgres.exec(`CREATE TABLE items(id text PRIMARY KEY, server_id integer, series_id text, type text,
  production_year integer, provider_ids jsonb, parent_index_number integer, index_number integer, runtime_ticks bigint,
  series_name text, series_primary_image_tag text, primary_image_tag text);
  CREATE TABLE sessions(id text PRIMARY KEY, server_id integer, user_id text, item_id text, item_name text, series_id text, series_name text,
  start_time timestamptz, end_time timestamptz, play_duration integer, runtime_ticks bigint, position_ticks bigint, completed boolean,
  is_inferred boolean, device_name text, client_name text, raw_data jsonb);`);
const sourceDate = "2026-04-25T12:34:56.123456Z";
await saveLedgerRows({
  ...scope,
  rows: [
    {
      kind: "simkl-json",
      sourceKey: "legacy-import",
      payload: {
        title: { key: "legacy-title", name: "Imported movie", kind: "movie" },
        history: [
          {
            key: "legacy-history",
            title: { key: "legacy-title", name: "Imported movie", kind: "movie" },
            watchedAt: null,
            originalWatchedAt: sourceDate,
            accuracy: "unknown",
            runtime: 100,
            completed: true,
            source: "simkl",
          },
        ],
      },
    },
  ],
});
const { getWatchLedger } = await import("../store");
const migrated = await getWatchLedger(scope);
assert.equal(migrated.watches.find((watch) => watch.title.key === "legacy-title")?.end, sourceDate);
assert.equal(
  migrated.watches.find((watch) => watch.title.key === "legacy-title")?.accuracy,
  "accurate",
);
await postgres.close();

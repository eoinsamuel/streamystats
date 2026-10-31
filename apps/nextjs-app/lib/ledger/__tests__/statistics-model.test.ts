import { expect, test } from "bun:test";
import { buildWatches, type HistoryEntry } from "../engine";
import {
  importedContributions,
  importVisibleInLibraries,
  watchesForStatistics,
} from "../statistics-model";
import { mergeImportedRankings } from "../ranking-model";
const entry: HistoryEntry = {
  key: "one",
  title: { key: "show", name: "Example", kind: "tv", ids: { tvdb: "1" } },
  season: 1,
  episode: 2,
  watchedAt: "2026-10-02T12:00:00Z",
  accuracy: "estimated",
  runtime: 1200,
  completed: true,
  source: "simkl",
};
const watch = buildWatches({ history: [entry], playbacks: [], titles: [entry.title] })[0];
test("confirmed manual logs count without enabling imported history", () => {
  const manual = { ...watch, sources: ["manual"], accuracy: "accurate" as const };
  expect(watchesForStatistics([watch, manual], false)).toEqual([manual]);
  expect(watchesForStatistics([watch, manual], true)).toHaveLength(2);
});
test("overlap and inferred sessions cannot add imported runtime", () => {
  expect(
    importedContributions([
      { ...watch, estimatedSeconds: 0 },
      { ...watch, sources: ["inferred"] },
    ]),
  ).toHaveLength(0);
});
test("known library restrictions apply while personal outside-library titles remain visible", () => {
  const catalog = [
    {
      name: "Different title",
      year: null,
      kind: "tv" as const,
      ids: { TVDB: "1" },
      allowed: false,
    },
  ];
  expect(importVisibleInLibraries(watch, catalog)).toBe(false);
  expect(importVisibleInLibraries(watch, [{ ...catalog[0], allowed: true }])).toBe(true);
  expect(
    importVisibleInLibraries(
      { ...watch, title: { ...watch.title, name: "Outside", ids: {} } },
      catalog,
    ),
  ).toBe(true);
});
test("outside-Jellyfin imports get honest ranking entries and repeated imports merge", () => {
  const event = {
    userId: "viewer",
    userName: "Viewer",
    watch,
    seconds: 1200,
    day: "2026-10-02",
    hour: 12,
    remotePosters: false,
  };
  const result = mergeImportedRankings({ Movie: [], Episode: [], Series: [] }, [event, event]);
  expect(result.Series).toHaveLength(1);
  expect(result.Episode).toHaveLength(1);
  expect(result.Series[0]).toMatchObject({
    imported: true,
    totalPlayDuration: 2400,
    totalPlayCount: 2,
    importedWatchCount: 2,
  });
  expect(result.Series[0].id).toStartWith("ledger:");
});

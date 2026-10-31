import { expect, mock, test } from "bun:test";
import { buildWatches, defaults, type HistoryEntry, type Playback } from "../engine";
mock.module("server-only", () => ({}));
const { buildLedgerView } = await import("../view-model");
const history: HistoryEntry[] = Array.from({ length: 205 }, (_, index) => ({
  key: String(index),
  title: { key: String(index), name: `Movie ${index}`, kind: "movie" },
  watchedAt: "2026-10-02T12:00:00.000000Z",
  accuracy: "accurate",
  runtime: 100,
  completed: true,
  source: "manual",
}));
const ledger = {
  watches: buildWatches({ history, playbacks: [], titles: history.map((row) => row.title) }),
  titles: history.map((row) => row.title),
  settings: defaults,
  images: {},
  sessionCount: 0,
  hiddenCount: 0,
};
test("pages are bounded while recap and headline totals use the complete history", () => {
  const pages = [0, 1, 2].map((page) =>
    buildLedgerView(ledger, new URLSearchParams({ page: String(page), month: "2026-10" })),
  );
  expect(pages.map((page) => page.grouped.flatMap(([, rows]) => rows).length)).toEqual([
    100, 100, 5,
  ]);
  for (const page of pages) {
    expect(page.totals.completed).toBe(205);
    expect(page.recaps.month.count).toBe(205);
    expect(page.recaps.month.imported).toBe(20500);
    expect(page.timeline.find((entry) => entry.type === "day")?.watchTime).toEqual({
      recorded: 0,
      imported: 20500,
    });
  }
  expect(new Set(pages.flatMap((page) => page.watches.map((watch) => watch.id))).size).toBe(205);
});
test("watch status filters do not change summary totals", () => {
  const view = buildLedgerView(
    ledger,
    new URLSearchParams({ watchStatus: "in-progress", month: "2026-10" }),
  );
  expect(view.grouped).toHaveLength(0);
  expect(view.totals.completed).toBe(205);
});
test("search and dates are applied before pagination", () => {
  const view = buildLedgerView(ledger, new URLSearchParams({ search: "Movie 204" }));
  expect(view.pagination.total).toBe(1);
  expect(view.watches[0].title.name).toBe("Movie 204");
  expect(
    buildLedgerView(ledger, new URLSearchParams({ from: "2026-10-03" })).pagination.total,
  ).toBe(0);
});
test("a finished resumed watch is absent from the unfinished filter on every day", () => {
  const session: Playback = {
    id: "one",
    itemId: "movie",
    title: { key: "movie", name: "Movie", kind: "movie" },
    episodeTitle: "Movie",
    start: "2026-10-01T12:00:00Z",
    end: "2026-10-01T12:01:00Z",
    seconds: 60,
    runtime: 100,
    position: 60,
    completed: false,
    inferred: false,
    device: "TV",
    ranges: null,
    startPosition: null,
  };
  const watches = buildWatches({
    playbacks: [
      session,
      {
        ...session,
        id: "two",
        start: "2026-10-02T12:00:00Z",
        end: "2026-10-02T12:00:40Z",
        position: 100,
        completed: true,
      },
    ],
    history: [],
    titles: [],
  });
  const all = buildLedgerView({ ...ledger, watches }, new URLSearchParams());
  expect(all.pagination.total).toBe(2);
  expect(all.timeline.filter((entry) => entry.type === "day").map((entry) => entry.watchTime)).toEqual([
    { recorded: 60, imported: 0 },
    { recorded: 60, imported: 0 },
  ]);
  expect(
    buildLedgerView({ ...ledger, watches }, new URLSearchParams({ watchStatus: "in-progress" }))
      .pagination.total,
  ).toBe(0);
});

test("dated estimates use normal daily cards and only undated entries stay at the bottom", () => {
  const entries: HistoryEntry[] = [
    {
      ...history[0],
      key: "estimate",
      accuracy: "estimated",
      watchedAt: "2026-09-25T12:00:00.000000Z",
      source: "simkl",
    },
    { ...history[1], key: "undated", accuracy: "unknown", watchedAt: null, source: "simkl" },
  ];
  const watches = buildWatches({
    history: entries,
    playbacks: [],
    titles: entries.map((entry) => entry.title),
  });
  const view = buildLedgerView({ ...ledger, watches }, new URLSearchParams());
  expect(view.grouped.map(([day]) => day)).toEqual(["2026-09-25", "Watch date unknown"]);
  expect(view.grouped[0][1][0].accuracy).toBe("estimated");
  expect(view.timeline.find((entry) => entry.type === "day" && entry.day === "Watch date unknown")?.watchTime).toBeNull();
});
test("the statistics switch changes totals and recaps without hiding imported history", () => {
  const entries: HistoryEntry[] = [{ ...history[0], source: "simkl", accuracy: "estimated" }];
  const watches = buildWatches({
    history: entries,
    playbacks: [],
    titles: entries.map((entry) => entry.title),
  });
  const off = buildLedgerView({ ...ledger, watches }, new URLSearchParams({ month: "2026-10" }));
  const on = buildLedgerView(
    { ...ledger, watches, settings: { ...defaults, includeImportedStats: true } },
    new URLSearchParams({ month: "2026-10" }),
  );
  expect(off.pagination.total).toBe(1);
  expect(on.pagination.total).toBe(1);
  expect(off.totals.completed).toBe(0);
  expect(off.recaps.month.imported).toBe(0);
  expect(on.totals.completed).toBe(1);
  expect(on.recaps.month.imported).toBe(100);
  expect(off.timeline.find((entry) => entry.type === "day")?.watchTime).toEqual({ recorded: 0, imported: 0 });
  expect(on.timeline.find((entry) => entry.type === "day")?.watchTime).toEqual({ recorded: 0, imported: 100 });
});
test("recaps appear before their periods and do not repeat on later pages", () => {
  const first = buildLedgerView(ledger, new URLSearchParams());
  expect(first.timeline.map((entry) => entry.type)).toEqual(["recap", "recap", "day"]);
  expect(first.timeline[0]).toMatchObject({ period: "month", start: "2026-10-01" });
  expect(first.timeline[1]).toMatchObject({ period: "week", start: "2026-09-28" });
  const next = buildLedgerView(ledger, new URLSearchParams({ page: "1" }));
  expect(next.timeline.map((entry) => entry.type)).toEqual(["day"]);
});
test("week and month boundaries stay chronological across year changes", () => {
  const entries: HistoryEntry[] = ["2027-01-04", "2027-01-01", "2026-12-31", "2026-12-27"].map(
    (day, index) => ({ ...history[index], watchedAt: `${day}T12:00:00Z` }),
  );
  const watches = buildWatches({
    history: entries,
    playbacks: [],
    titles: entries.map((entry) => entry.title),
  });
  const view = buildLedgerView({ ...ledger, watches }, new URLSearchParams());
  const markers = view.timeline.filter((entry) => entry.type === "recap");
  expect(markers.map((entry) => entry.key)).toEqual([
    "month:2027-01-01",
    "week:2027-01-04",
    "week:2026-12-28",
    "month:2026-12-01",
    "week:2026-12-21",
  ]);
  expect(new Set(markers.map((entry) => entry.key)).size).toBe(markers.length);
});

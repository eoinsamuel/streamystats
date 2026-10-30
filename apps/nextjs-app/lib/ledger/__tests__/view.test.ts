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
  expect(buildLedgerView({ ...ledger, watches }, new URLSearchParams()).pagination.total).toBe(2);
  expect(
    buildLedgerView({ ...ledger, watches }, new URLSearchParams({ watchStatus: "in-progress" }))
      .pagination.total,
  ).toBe(0);
});

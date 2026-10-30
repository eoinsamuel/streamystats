import { test, expect } from "bun:test";
import type { TrackedSession } from "../jellyfin/types";
import { observePlayback, observeFinalPlayback } from "./watch-coverage";
const ticks = (s: number) => s * 10000000;
test("ordinary playback accumulates and compresses ranges", () => {
  const r = observePlayback({
    ranges: [],
    previousTicks: 0,
    currentTicks: ticks(5),
    elapsedSeconds: 5,
    wasPaused: false,
  });
  expect(
    observePlayback({
      ranges: r,
      previousTicks: ticks(5),
      currentTicks: ticks(10),
      elapsedSeconds: 5,
      wasPaused: false,
    }),
  ).toEqual([[0, 10]]);
});
test("pauses, seek jumps, network gaps and rewinds do not manufacture coverage", () => {
  for (const changes of [
    { wasPaused: true },
    { currentTicks: ticks(2000) },
    { elapsedSeconds: 60 },
    { previousTicks: ticks(20) },
  ])
    expect(
      observePlayback({
        ranges: [],
        previousTicks: 0,
        currentTicks: ticks(5),
        elapsedSeconds: 5,
        wasPaused: false,
        ...changes,
      }),
    ).toEqual([]);
});
test("ambiguous faster progression and small seeks do not manufacture coverage", () =>
  expect(
    observePlayback({
      ranges: [],
      previousTicks: 0,
      currentTicks: ticks(10),
      elapsedSeconds: 5,
      wasPaused: false,
    }),
  ).toEqual([]));

test("explicit seek events are rejected even when the delta looks normal", () => {
  expect(
    observePlayback({
      ranges: [],
      previousTicks: 0,
      currentTicks: ticks(5),
      elapsedSeconds: 5,
      wasPaused: false,
      didSeek: true,
    }),
  ).toEqual([]);
});

test("an observed final segment is retained without inventing an unobserved tail", () => {
  const now = new Date("2026-10-30T12:00:05Z");
  const tracked: TrackedSession = {
    sessionKey: "key",
    userJellyfinId: "user",
    userName: "Viewer",
    itemId: "movie",
    sessionId: "session",
    positionTicks: ticks(88),
    runtimeTicks: ticks(100),
    watchedRanges: [[0, 88]],
    startTime: new Date("2026-10-30T11:58:00Z"),
    lastUpdateTime: new Date("2026-10-30T12:00:00Z"),
    isPaused: false,
    playDuration: 88,
  };
  const final = observeFinalPlayback({
    tracked,
    now,
    observation: { Id: "session", PlayState: { PositionTicks: ticks(93) } },
  });
  expect(final.watchedRanges).toEqual([[0, 93]]);
  expect(observeFinalPlayback({ tracked, now })).toBe(tracked);
  expect(
    observeFinalPlayback({
      tracked,
      now,
      observation: {
        Id: "session",
        NowPlayingItem: { Id: "other" },
        PlayState: { PositionTicks: ticks(93) },
      },
    }),
  ).toBe(tracked);
});

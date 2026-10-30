import type { TrackedSession, JellyfinSession } from "../jellyfin/types";
export type WatchedRange = [number, number];
/** Polling cannot identify every seek. Accept only plausible 1x progression. */
export function observePlayback({
  ranges,
  previousTicks,
  currentTicks,
  elapsedSeconds,
  wasPaused,
  didSeek = false,
}: {
  ranges: WatchedRange[];
  previousTicks: number;
  currentTicks: number;
  elapsedSeconds: number;
  wasPaused: boolean;
  didSeek?: boolean;
}): WatchedRange[] {
  const delta = (currentTicks - previousTicks) / 10000000;
  // The Sessions API supplies no playback rate or seek event. Faster jumps
  // are ambiguous, so prefer missing coverage over counting skipped content.
  if (
    didSeek ||
    wasPaused ||
    !Number.isFinite(delta) ||
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds <= 0 ||
    elapsedSeconds > 20 ||
    delta <= 0 ||
    delta > elapsedSeconds + 0.5
  )
    return ranges;
  const next: WatchedRange = [previousTicks / 10000000, currentTicks / 10000000];
  const output: WatchedRange[] = ranges.map(([a, b]) => [a, b]);
  const last = output.at(-1);
  if (last && next[0] >= last[0] && next[0] <= last[1] + 0.1) last[1] = Math.max(last[1], next[1]);
  else output.push(next);
  return output;
}

export function observeFinalPlayback({
  tracked,
  observation,
  now,
}: {
  tracked: TrackedSession;
  observation?: JellyfinSession;
  now: Date;
}) {
  if (
    !observation ||
    observation.Id !== tracked.sessionId ||
    (observation.NowPlayingItem &&
      observation.NowPlayingItem.Id !== (tracked.jellyfinItemId ?? tracked.itemId))
  )
    return tracked;
  const position = observation.PlayState?.PositionTicks;
  if (typeof position !== "number" || !Number.isFinite(position)) return tracked;
  return {
    ...tracked,
    watchedRanges: observePlayback({
      ranges: tracked.watchedRanges ?? [],
      previousTicks: tracked.positionTicks,
      currentTicks: position,
      elapsedSeconds: (now.getTime() - tracked.lastUpdateTime.getTime()) / 1000,
      wasPaused: tracked.isPaused,
    }),
    positionTicks: Math.max(tracked.positionTicks, position),
  };
}

export type WatchedRange = [number, number];
/** Accept normal playback, including faster playback, but reject seek jumps. */
export function observePlayback({
	ranges,
	previousTicks,
	currentTicks,
	elapsedSeconds,
	wasPaused,
}: {
	ranges: WatchedRange[];
	previousTicks: number;
	currentTicks: number;
	elapsedSeconds: number;
	wasPaused: boolean;
}): WatchedRange[] {
	const delta = (currentTicks - previousTicks) / 10000000;
	if (
		wasPaused ||
		elapsedSeconds <= 0 ||
		elapsedSeconds > 20 ||
		delta <= 0 ||
		delta > elapsedSeconds * 3 + 2
	)
		return ranges;
	const next: WatchedRange = [
		previousTicks / 10000000,
		currentTicks / 10000000,
	];
	const output: WatchedRange[] = ranges.map(([a, b]) => [a, b]);
	const last = output.at(-1);
	if (last && next[0] >= last[0] && next[0] <= last[1] + 0.1)
		last[1] = Math.max(last[1], next[1]);
	else output.push(next);
	return output;
}

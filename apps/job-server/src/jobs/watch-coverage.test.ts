import { test, expect } from "bun:test";
import { observePlayback } from "./watch-coverage";
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
test("double-speed playback counts actual media ranges", () =>
	expect(
		observePlayback({
			ranges: [],
			previousTicks: 0,
			currentTicks: ticks(10),
			elapsedSeconds: 5,
			wasPaused: false,
		}),
	).toEqual([[0, 10]]));

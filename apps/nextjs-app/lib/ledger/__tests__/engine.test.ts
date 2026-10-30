import { describe, test, expect } from "bun:test";
import {
	buildWatches,
	groupHistoryDays,
	mergeTitle,
	simklPoster,
	defaults,
	mergeRanges,
	rangeCoverage,
	type Playback,
	type HistoryEntry,
	type Title,
} from "../engine";
import { parseSimklJson, parseSimklCsv } from "../import";
const title: Title = { key: "test", name: "Test Show", kind: "tv" };
function playback(p: Partial<Playback> = {}): Playback {
	return {
		id: "one",
		itemId: "ep",
		title,
		season: 1,
		episode: 1,
		episodeTitle: "Pilot",
		start: "2026-09-01T18:00:00Z",
		end: "2026-09-01T18:20:00Z",
		seconds: 1200,
		runtime: 2400,
		position: 1200,
		completed: false,
		inferred: false,
		device: "TV",
		ranges: null,
		startPosition: null,
		...p,
	};
}
const run = (playbacks: Playback[], history: HistoryEntry[] = []) =>
	buildWatches({ playbacks, history, titles: [title] });
describe("watches, rather than sessions", () => {
	test("resumes hours or days later stay one watch", () => {
		const watches = run([
			playback(),
			playback({
				id: "two",
				start: "2026-09-03T20:00:00Z",
				end: "2026-09-03T20:20:00Z",
				position: 2400,
				completed: true,
			}),
		]);
		expect(watches).toHaveLength(1);
		expect(watches[0].rewatch).toBe(false);
		expect(watches[0].measuredSeconds).toBe(2400);
	});
	test("legacy starts never manufacture automatic rewatches", () => {
		expect(
			run([
				playback({ completed: true }),
				playback({
					id: "two",
					start: "2026-09-02T18:00:00Z",
					completed: true,
					position: 2400,
				}),
			]),
		).toHaveLength(1);
	});
	test("unique ranges union across resumes", () => {
		const result = run([
			playback({ ranges: [[0, 1200]], startPosition: 0 }),
			playback({
				id: "two",
				start: "2026-09-02T18:00:00Z",
				end: "2026-09-02T18:20:00Z",
				ranges: [[1100, 2300]],
				startPosition: 1100,
			}),
		]);
		expect(result).toHaveLength(1);
		expect(result[0].completed).toBe(true);
		expect(result[0].coverage).toBeCloseTo(2300 / 2400);
	});
	test("repeated scenes do not add coverage", () => {
		expect(
			rangeCoverage(
				[
					[0, 300],
					[0, 300],
					[10, 290],
				],
				2400,
			),
		).toBe(0.125);
		expect(
			mergeRanges([
				[4, 8],
				[0, 5],
			]),
		).toEqual([[0, 8]]);
	});
	test("seek to credits cannot complete a range-aware watch", () => {
		expect(
			run([
				playback({
					ranges: [
						[0, 30],
						[2350, 2380],
					],
					position: 2380,
					completed: true,
				}),
			])[0].completed,
		).toBe(false);
	});
	test("restart after a completed watch counts only after completion", () => {
		const first = playback({
			ranges: [[0, 2300]],
			completed: true,
			startPosition: 0,
		});
		const next = playback({
			id: "two",
			start: "2026-09-02T18:00:00Z",
			end: "2026-09-02T18:10:00Z",
			ranges: [[0, 400]],
			startPosition: 0,
		});
		const watches = run([first, next]);
		expect(watches).toHaveLength(2);
		expect(watches.filter((w) => w.rewatch && w.completed)).toHaveLength(0);
		const done = run([first, { ...next, ranges: [[0, 2300]] }]);
		expect(done.filter((w) => w.rewatch && w.completed)).toHaveLength(1);
	});
	test("reopening near the end continues the completed watch", () => {
		const a = playback({ ranges: [[0, 2300]], startPosition: 0 });
		const b = playback({
			id: "two",
			start: "2026-09-02T18:00:00Z",
			ranges: [[2300, 2350]],
			startPosition: 2300,
		});
		expect(run([a, b])).toHaveLength(1);
	});
	test("matching SIMKL history does not duplicate measured watch", () => {
		const h: HistoryEntry = {
			key: "h",
			title,
			season: 1,
			episode: 1,
			watchedAt: "2026-09-01T18:20:00Z",
			accuracy: "accurate",
			runtime: 2400,
			completed: true,
			source: "simkl",
		};
		const w = run([playback()], [h]);
		expect(w).toHaveLength(1);
		expect(w[0].sources).toContain("simkl");
		expect(w[0].estimatedSeconds).toBe(0);
	});
	test("unknown dates do not imply a dated prior watch", () => {
		const h: HistoryEntry = {
			key: "h",
			title,
			season: 1,
			episode: 1,
			watchedAt: null,
			accuracy: "unknown",
			runtime: 2400,
			completed: true,
			source: "simkl",
		};
		expect(
			run([playback({ completed: true })], [h]).filter((w) => w.rewatch),
		).toHaveLength(0);
	});
	test("confirmed Smallville baseline works without exact first-watch dates", () => {
		const smallville: Title = { ...title, name: "Smallville" };
		const h: HistoryEntry = {
			key: "h",
			title: smallville,
			season: 1,
			episode: 1,
			watchedAt: "2026-02-01T18:00:00Z",
			accuracy: "estimated",
			runtime: 2400,
			completed: true,
			source: "simkl",
		};
		const w = buildWatches({
			playbacks: [playback({ title: smallville, completed: true })],
			history: [h],
			titles: [smallville],
		});
		expect(w.filter((w) => w.rewatch && w.completed)).toHaveLength(1);
	});
	test("legacy imported endpoint copies do not double time", () => {
		const a = playback();
		const b = playback({
			id: "import",
			imported: true,
			start: a.end,
			end: a.end,
			seconds: 1300,
		});
		expect(run([a, b])[0].measuredSeconds).toBe(1200);
	});
	test("per-watch corrections are reversible and preserve raw sessions", () => {
		const a = playback();
		const hidden = buildWatches({
			playbacks: [a],
			history: [],
			titles: [title],
			corrections: { "play:one": { hidden: true } },
		});
		expect(hidden).toHaveLength(0);
		expect(a.seconds).toBe(1200);
		expect(run([a])).toHaveLength(1);
	});
});
describe("history imports", () => {
	test("setup-day and invalid dates are unknown; earlier dates estimated", () => {
		const root = {
			shows: [
				{
					show: { title: "Test", runtime: 40, ids: { simkl: 1 } },
					status: "completed",
					seasons: [
						{
							number: 1,
							episodes: [
								{ number: 1, watched_at: "2026-04-25T00:00:00Z" },
								{ number: 2, watched_at: "1970-01-01T00:00:01Z" },
								{ number: 3, watched_at: "2026-03-01T00:00:00Z" },
								{ number: 4, watched_at: "2026-05-01T00:00:00Z" },
							],
						},
					],
				},
			],
		};
		const payload = parseSimklJson(root)[0].payload;
		const history = payload.history as HistoryEntry[];
		expect(history.map((h) => h.accuracy)).toEqual([
			"unknown",
			"unknown",
			"estimated",
			"accurate",
		]);
		expect(history[0].watchedAt).toBeNull();
	});
	test("CSV quoted commas and summaries do not invent episode history", () => {
		const values = parseSimklCsv(
			'SIMKL_ID,Title,Type,Watchlist,LastEpWatched\n1,"A, B",tv show,watching,s2e3\n',
		);
		expect(values[0].payload.title).toMatchObject({
			name: "A, B",
			latestEpisode: "s2e3",
		});
		expect(values[0].payload.history).toBeUndefined();
	});
	test("unknown import format is rejected", () =>
		expect(() => parseSimklJson({})).toThrow());
});
test("estimated imports enrich existing viewing instead of creating a second watch", () => {
	const h: HistoryEntry = {
		key: "h",
		title,
		season: 1,
		episode: 1,
		watchedAt: null,
		accuracy: "unknown",
		runtime: 2400,
		completed: true,
		source: "simkl",
	};
	const w = run([playback({ completed: true })], [h]);
	expect(w).toHaveLength(1);
	expect(w[0].rewatch).toBe(false);
});
test("an explicitly logged manual watch is never absorbed into a near-time session", () => {
	const h: HistoryEntry = {
		key: "manual",
		title,
		season: 1,
		episode: 1,
		watchedAt: "2026-09-01T20:00:00Z",
		accuracy: "accurate",
		runtime: 2400,
		completed: true,
		source: "manual",
	};
	const w = run([playback({ completed: true })], [h]);
	expect(w).toHaveLength(2);
	expect(w.filter((x) => x.rewatch && x.completed)).toHaveLength(1);
});

test("daily activity from a resumed watch remains one logical watch", () => {
	const result = run([
		playback(),
		playback({
			id: "two",
			start: "2026-09-03T18:00:00Z",
			end: "2026-09-03T18:20:00Z",
			completed: true,
		}),
	]);
	const days = groupHistoryDays(result, "UTC");
	expect(result).toHaveLength(1);
	expect(days).toHaveLength(2);
	expect(days[0][1][0].completed).toBe(true);
	expect(days[1][1][0].completed).toBe(false);
	expect(days[0][1][0].measuredSeconds + days[1][1][0].measuredSeconds).toBe(
		2400,
	);
});

test("list/rating edits preserve external IDs and imported posters", () => {
	const a = { ...title, ids: { tvdb: "123" }, poster: "p", rating: 8 };
	const b = mergeTitle(a, { ...title, status: "completed" });
	expect(b.ids?.tvdb).toBe("123");
	expect(b.poster).toBe("p");
	expect(b.rating).toBe(8);
});

test("poster paths cannot become arbitrary image URLs", () => {
	expect(simklPoster("16/165120c2527aab1")).toBe(
		"https://simkl.in/posters/16/165120c2527aab1_c.webp",
	);
	expect(simklPoster("https://example.com/private")).toBeNull();
	expect(simklPoster("../local")).toBeNull();
});

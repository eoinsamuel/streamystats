import { mergeTitle } from "./engine";
import "server-only";
import {
	db,
	items,
	ledgerRecords,
	sessions,
	type Item,
} from "@streamystats/database";
import { and, eq, type SQL } from "drizzle-orm";
import { getStatisticsExclusions } from "@/lib/db/exclusions";
import {
	type Correction,
	type HistoryEntry,
	type LedgerSettings,
	type Playback,
	type Range,
	type Title,
	buildWatches,
	defaults,
	record,
	validDate,
} from "./engine";
function titleValue(value: unknown): Title | null {
	const r = record(value);
	if (
		!r ||
		typeof r.key !== "string" ||
		typeof r.name !== "string" ||
		(r.kind !== "tv" && r.kind !== "movie" && r.kind !== "anime")
	)
		return null;
	return {
		key: r.key,
		name: r.name,
		kind: r.kind,
		year: typeof r.year === "number" ? r.year : undefined,
		ids: ids(r.ids),
		status: typeof r.status === "string" ? r.status : undefined,
		rating: typeof r.rating === "number" ? r.rating : undefined,
		poster: typeof r.poster === "string" ? r.poster : undefined,
		latestEpisode:
			typeof r.latestEpisode === "string" ? r.latestEpisode : undefined,
	};
}
function historyValue(value: unknown): HistoryEntry | null {
	const r = record(value);
	if (!r) return null;
	const title = titleValue(r.title);
	if (
		!title ||
		typeof r.key !== "string" ||
		typeof r.runtime !== "number" ||
		!Number.isFinite(r.runtime) ||
		typeof r.completed !== "boolean" ||
		(r.source !== "simkl" && r.source !== "manual") ||
		(r.accuracy !== "accurate" &&
			r.accuracy !== "estimated" &&
			r.accuracy !== "unknown")
	)
		return null;
	return {
		key: r.key,
		title,
		runtime: Math.max(0, r.runtime),
		completed: r.completed,
		source: r.source,
		accuracy: r.accuracy,
		watchedAt: validDate(r.watchedAt),
		originalWatchedAt: validDate(r.originalWatchedAt),
		season: typeof r.season === "number" ? r.season : undefined,
		episode: typeof r.episode === "number" ? r.episode : undefined,
		episodeTitle:
			typeof r.episodeTitle === "string" ? r.episodeTitle : undefined,
	};
}
function rangesValue(value: unknown): Range[] | null {
	if (!Array.isArray(value)) return null;
	return value.flatMap((v) =>
		Array.isArray(v) &&
		v.length === 2 &&
		v.every((x) => typeof x === "number" && Number.isFinite(x))
			? [[v[0], v[1]] as Range]
			: [],
	);
}
function ids(value: unknown): Record<string, string> {
	const r = record(value);
	return r
		? Object.fromEntries(
				Object.entries(r)
					.filter(([, v]) => typeof v === "string")
					.map(([k, v]) => [k.toLowerCase(), String(v)]),
			)
		: {};
}
export async function getWatchLedger({
	serverId,
	userId,
}: {
	serverId: number;
	userId: string;
}) {
	const exclusions = await getStatisticsExclusions(serverId, userId);
	const conditions: SQL[] = [
		eq(sessions.serverId, serverId),
		eq(sessions.userId, userId),
	];
	if (exclusions.userExclusion) conditions.push(exclusions.userExclusion);
	if (exclusions.itemLibraryExclusion)
		conditions.push(exclusions.itemLibraryExclusion);
	const [rows, records, series] = await Promise.all([
		db
			.select({ session: sessions, item: items })
			.from(sessions)
			.leftJoin(items, eq(sessions.itemId, items.id))
			.where(and(...conditions)),
		db
			.select()
			.from(ledgerRecords)
			.where(
				and(
					eq(ledgerRecords.serverId, serverId),
					eq(ledgerRecords.userId, userId),
				),
			),
		db
			.select()
			.from(items)
			.where(and(eq(items.serverId, serverId), eq(items.type, "Series"))),
	]);
	const seriesById = new Map(series.map((s) => [s.id, s]));
	const titlesById = new Map<string, Title>(),
		history: HistoryEntry[] = [],
		corrections: Record<string, Correction> = {};
	let settings: LedgerSettings = { ...defaults };
	// CSV is the newer list snapshot even when the older JSON is uploaded later.
	const kinds = [
		"simkl-json",
		"simkl-csv",
		"manual",
		"title",
		"correction",
		"settings",
	];
	for (const kind of kinds)
		for (const row of records.filter((r) => r.kind === kind)) {
			const payload = row.payload;
			if (kind === "settings") {
				if (typeof payload.completionThreshold === "number")
					settings.completionThreshold = payload.completionThreshold;
				if (typeof payload.timezone === "string")
					settings.timezone = payload.timezone;
				if (typeof payload.remotePosters === "boolean")
					settings.remotePosters = payload.remotePosters;
				if (typeof payload.setupDay === "string")
					settings.setupDay = payload.setupDay;
				if (Array.isArray(payload.confirmedPriorTitles))
					settings.confirmedPriorTitles = payload.confirmedPriorTitles.filter(
						(v): v is string => typeof v === "string",
					);
				continue;
			}
			if (kind === "correction") {
				corrections[row.sourceKey] = payload;
				continue;
			}
			const title = titleValue(payload.title);
			if (title) {
				const previous = titlesById.get(title.key);
				titlesById.set(title.key, mergeTitle(previous, title));
			}
			if (Array.isArray(payload.history))
				for (const value of payload.history) {
					const h = historyValue(value);
					if (h) history.push(h);
				}
			if (kind === "manual") {
				const h = historyValue(payload);
				if (h) history.push(h);
			}
		}
	function sessionTitle(
		s: typeof sessions.$inferSelect,
		item: Item | null,
	): Title {
		const show = s.seriesId ? seriesById.get(s.seriesId) : undefined;
		const kind = s.seriesName || item?.type === "Episode" ? "tv" : "movie";
		return {
			key:
				kind === "movie"
					? `jellyfin:${s.itemId ?? s.itemName}`
					: `jellyfin:${s.seriesId ?? s.seriesName}`,
			name:
				kind === "movie"
					? (s.itemName ?? "Unknown movie")
					: (s.seriesName ?? item?.seriesName ?? "Unknown show"),
			kind,
			year: show?.productionYear ?? item?.productionYear ?? undefined,
			ids: ids(show?.providerIds ?? item?.providerIds),
		};
	}
	const playbacks: Playback[] = rows.flatMap(({ session: s, item }) => {
		if (!s.startTime) return [];
		const raw = record(s.rawData);
		return [
			{
				id: s.id,
				itemId: s.itemId,
				title: sessionTitle(s, item),
				season: item?.parentIndexNumber ?? undefined,
				episode: item?.indexNumber ?? undefined,
				episodeTitle: s.itemName ?? "Unknown title",
				start: s.startTime.toISOString(),
				end: (s.endTime ?? s.startTime).toISOString(),
				seconds: s.playDuration ?? 0,
				runtime: (s.runtimeTicks ?? item?.runtimeTicks ?? 0) / 10000000,
				position: (s.positionTicks ?? 0) / 10000000,
				completed: s.completed,
				inferred: s.isInferred,
				device: s.deviceName ?? s.clientName ?? "Unknown device",
				ranges: rangesValue(raw?.watchedRanges),
				imported: Boolean(
					raw && "ActivityDateInserted" in raw && "PlaybackDuration" in raw,
				),
				startPosition:
					typeof raw?.startPositionTicks === "number"
						? raw.startPositionTicks / 10000000
						: null,
			},
		];
	});
	// Settings can reclassify dates without rewriting imported source records.
	for (const h of history.filter((h) => h.source === "simkl")) {
		const date = validDate(h.originalWatchedAt ?? h.watchedAt);
		if (!date) continue;
		if (date.slice(0, 10) === settings.setupDay) {
			h.watchedAt = null;
			h.accuracy = "unknown";
		} else {
			h.watchedAt = date;
			h.accuracy =
				date.slice(0, 10) < settings.setupDay ? "estimated" : "accurate";
		}
	}
	const titles = [...titlesById.values()];
	const watches = exclusions.excludedUserIds.includes(userId)
		? []
		: buildWatches({
				playbacks,
				history,
				titles,
				corrections,
				settings,
			});
	const images: Record<string, { itemId: string; tag: string }> = {};
	for (const { session: s, item } of rows)
		if (item) {
			const imageId = item.seriesId ?? item.id,
				tag = item.seriesPrimaryImageTag ?? item.primaryImageTag;
			if (tag) images[s.id] = { itemId: imageId, tag };
		}
	return {
		watches,
		titles,
		settings,
		images,
		sessionCount: playbacks.length,
		hiddenCount: Object.values(corrections).filter((c) => c.hidden).length,
	};
}

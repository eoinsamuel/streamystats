export type Accuracy = "accurate" | "estimated" | "unknown";
export type MediaKind = "tv" | "movie" | "anime";
export type Range = [number, number];
export interface Title {
  key: string;
  name: string;
  kind: MediaKind;
  year?: number;
  ids?: Record<string, string>;
  status?: string;
  rating?: number;
  poster?: string;
  latestEpisode?: string;
}
export interface HistoryEntry {
  key: string;
  title: Title;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  watchedAt: string | null;
  accuracy: Accuracy;
  runtime: number;
  completed: boolean;
  source: "simkl" | "manual";
  originalWatchedAt?: string | null;
}
export interface Playback {
  id: string;
  itemId: string | null;
  title: Title;
  season?: number;
  episode?: number;
  episodeTitle: string;
  start: string;
  end: string;
  seconds: number;
  runtime: number;
  position: number;
  completed: boolean;
  inferred: boolean;
  device: string;
  ranges: Range[] | null;
  startPosition: number | null;
  imported?: boolean;
}
export interface Watch {
  dateCorrected?: boolean;
  id: string;
  mediaKey: string;
  title: Title;
  itemId: string | null;
  season?: number;
  episode?: number;
  episodeTitle: string;
  start: string | null;
  end: string | null;
  accuracy: Accuracy;
  completed: boolean;
  rewatch: boolean;
  coverage: number | null;
  measuredSeconds: number;
  estimatedSeconds: number;
  runtime: number;
  sessions: Playback[];
  sources: string[];
  ranges: Range[];
  completionBasis: "measured" | "reported" | "imported" | "incomplete";
}
export interface Correction {
  hidden?: boolean;
  completed?: boolean;
  rewatch?: boolean;
  watchedAt?: string;
}
export interface LedgerSettings {
  completionThreshold: number;
  timezone: string;
  confirmedPriorTitles: string[];
  remotePosters: boolean;
  includeImportedStats: boolean;
}
export const defaults: LedgerSettings = {
  completionThreshold: 0.9,
  timezone: "UTC",
  confirmedPriorTitles: [],
  remotePosters: true,
  includeImportedStats: false,
};
export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
export function validDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time <= Date.UTC(1971, 0, 1)) return null;
  // Date carries milliseconds; retain the source fraction before UTC conversion.
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1] ?? "";
  const iso = new Date(time).toISOString();
  return iso.replace(/\.\d{3}Z$/, `.${fraction ? fraction.padEnd(6, "0").slice(0, 6) : "000000"}Z`);
}
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
export function dayKey(value: string, timezone: string): string {
  let formatter = dateFormatters.get(timezone);
  if (!formatter) {
    if (dateFormatters.size >= 64) {
      const oldest = dateFormatters.keys().next().value;
      if (oldest !== undefined) dateFormatters.delete(oldest);
    }
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(new Date(value));
  const get = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a)
    .map(([a, b]): Range => [a, b])
    .sort((a, b) => a[0] - b[0]);
  const output: Range[] = [];
  for (const range of sorted) {
    const last = output.at(-1);
    if (last && range[0] <= last[1] + 0.1) last[1] = Math.max(last[1], range[1]);
    else output.push([...range]);
  }
  return output;
}
export function rangeCoverage(ranges: Range[], runtime: number): number {
  return runtime > 0
    ? Math.min(
        1,
        mergeRanges(ranges).reduce(
          (sum, [a, b]) => sum + Math.max(0, Math.min(b, runtime) - Math.min(a, runtime)),
          0,
        ) / runtime,
      )
    : 0;
}
export function mediaKey(title: Title, season?: number, episode?: number): string {
  return title.kind === "movie" ? title.key : `${title.key}:s${season ?? "?"}:e${episode ?? "?"}`;
}
export function findTitle(input: Title, catalog: Title[]): Title {
  const byId = catalog.filter(
    (t) =>
      (t.kind === input.kind || (t.kind !== "movie" && input.kind !== "movie")) &&
      Object.entries(input.ids ?? {}).some(
        ([provider, id]) => Boolean(id) && t.ids?.[provider] === id,
      ),
  );
  if (byId.length === 1) return byId[0];
  const byName = catalog.filter(
    (t) =>
      (t.kind === input.kind || (t.kind !== "movie" && input.kind !== "movie")) &&
      normalize(t.name) === normalize(input.name) &&
      (!t.year || !input.year || t.year === input.year),
  );
  return byName.length === 1 ? byName[0] : input;
}
export function buildWatches({
  playbacks,
  history,
  titles,
  corrections = {},
  settings = defaults,
}: {
  playbacks: Playback[];
  history: HistoryEntry[];
  titles: Title[];
  corrections?: Record<string, Correction>;
  settings?: LedgerSettings;
}): Watch[] {
  const groups = new Map<string, { sessions: Playback[]; history: HistoryEntry[] }>();
  const group = (key: string) => {
    let value = groups.get(key);
    if (!value) {
      value = { sessions: [], history: [] };
      groups.set(key, value);
    }
    return value;
  };
  for (const entry of history) {
    const title = findTitle(entry.title, titles);
    group(mediaKey(title, entry.season, entry.episode)).history.push({
      ...entry,
      title,
    });
  }
  for (const original of playbacks) {
    const title = findTitle(original.title, titles),
      playback = { ...original, title };
    // Deleted metadata cannot identify an episode by number. Keep its original
    // Jellyfin identity; never guess a SIMKL episode from the title's order.
    const key =
      title.kind !== "movie" && (playback.season == null || playback.episode == null)
        ? `${title.key}:item:${playback.itemId ?? normalize(playback.episodeTitle)}`
        : mediaKey(title, playback.season, playback.episode);
    group(key).sessions.push(playback);
  }
  const watches: Watch[] = [];
  for (const [key, value] of groups) {
    const imports = value.history.sort((a, b) =>
      (a.watchedAt ?? "").localeCompare(b.watchedAt ?? ""),
    );
    const native = value.sessions
      .filter(
        (s) =>
          !s.inferred &&
          !(
            s.imported &&
            value.sessions.some(
              (n) =>
                !n.imported &&
                !n.inferred &&
                n.itemId === s.itemId &&
                Math.min(
                  Math.abs(Date.parse(s.start) - Date.parse(n.start)),
                  Math.abs(Date.parse(s.start) - Date.parse(n.end)),
                ) <= 30000,
            )
          ),
      )
      .sort((a, b) => a.start.localeCompare(b.start));
    const observed: Watch[] = [];
    const historical: Watch[] = imports.map((h) => ({
      id: `import:${h.key}`,
      mediaKey: key,
      title: h.title,
      itemId: null,
      season: h.season,
      episode: h.episode,
      episodeTitle:
        h.episodeTitle ?? (h.title.kind === "movie" ? h.title.name : `Episode ${h.episode ?? "?"}`),
      start: h.watchedAt,
      end: h.watchedAt,
      accuracy: h.accuracy,
      completed: h.completed,
      rewatch: false,
      coverage: null,
      measuredSeconds: 0,
      estimatedSeconds: h.completed ? h.runtime : 0,
      runtime: h.runtime,
      sessions: [],
      sources: [h.source],
      ranges: [],
      completionBasis: "imported",
    }));
    for (const session of native) {
      let current = observed.at(-1);
      // Only new range-aware recordings can automatically open another watch.
      // Legacy session endpoints cannot distinguish a resume from a restart.
      const restart =
        current?.completed &&
        session.ranges !== null &&
        session.runtime > 0 &&
        session.startPosition !== null &&
        session.startPosition <= session.runtime * 0.1 &&
        Date.parse(session.start) >= Date.parse(current.end ?? session.start);
      if (!current || restart) {
        current = {
          id: `play:${session.id}`,
          mediaKey: key,
          title: session.title,
          itemId: session.itemId,
          season: session.season,
          episode: session.episode,
          episodeTitle: session.episodeTitle,
          start: session.start,
          end: session.end,
          accuracy: "accurate",
          completed: false,
          rewatch: false,
          coverage: null,
          measuredSeconds: 0,
          estimatedSeconds: 0,
          runtime: session.runtime,
          sessions: [],
          sources: ["jellyfin"],
          ranges: [],
          completionBasis: "incomplete",
        };
        observed.push(current);
      }
      current.sessions.push(session);
      current.end = (current.end ?? "") > session.end ? current.end : session.end;
      current.measuredSeconds += Math.max(0, session.seconds);
      current.runtime = Math.max(current.runtime, session.runtime);
      if (session.ranges !== null) {
        current.ranges = mergeRanges([...current.ranges, ...session.ranges]);
        current.coverage = rangeCoverage(current.ranges, current.runtime);
        current.completed = current.coverage >= settings.completionThreshold;
        current.completionBasis = current.completed ? "measured" : "incomplete";
      } else if (
        current.coverage === null &&
        (session.completed ||
          (session.runtime > 0 &&
            session.position / session.runtime >= settings.completionThreshold))
      ) {
        current.completed = true;
        current.completionBasis = "reported";
      }
    }
    const unmatched: Watch[] = [];
    for (const imported of historical) {
      const time = imported.end ? Date.parse(imported.end) : null;
      const match =
        time !== null
          ? observed.find((w) =>
              w.sessions.some(
                (s) =>
                  time >= Date.parse(s.start) - 6 * 3600000 &&
                  time <= Date.parse(s.end) + 6 * 3600000,
              ),
            )
          : undefined;
      if (match && imported.sources.includes("simkl") && imported.end) {
        match.completed ||= imported.completed;
        match.sources.push(...imported.sources);
        if (match.completionBasis === "incomplete" && match.completed)
          match.completionBasis = "imported";
      } else if (
        imported.sources.includes("simkl") &&
        !imported.end &&
        observed.length &&
        !settings.confirmedPriorTitles.includes(normalize(imported.title.name))
      ) {
        const first = observed[0];
        first.completed ||= imported.completed;
        first.sources.push(...imported.sources);
        if (first.completionBasis === "incomplete" && first.completed)
          first.completionBasis = "imported";
      } else unmatched.push(imported);
    }
    // Inferred records supply prior-viewing context, not recorded clock time.
    if (!observed.length && !unmatched.length) {
      const inferred = value.sessions.find((s) => s.inferred);
      if (inferred)
        unmatched.push({
          id: `inferred:${inferred.id}`,
          mediaKey: key,
          title: inferred.title,
          itemId: inferred.itemId,
          season: inferred.season,
          episode: inferred.episode,
          episodeTitle: inferred.episodeTitle,
          start: null,
          end: null,
          accuracy: "unknown",
          completed: true,
          rewatch: false,
          coverage: null,
          measuredSeconds: 0,
          estimatedSeconds: inferred.runtime,
          runtime: inferred.runtime,
          sessions: [],
          sources: ["inferred"],
          ranges: [],
          completionBasis: "imported",
        });
    }
    const all = [...unmatched, ...observed].sort((a, b) =>
      (a.start ?? "").localeCompare(b.start ?? ""),
    );
    let completedBefore = false;
    for (const watch of all) {
      watch.rewatch = completedBefore;
      const correction = corrections[watch.id];
      if (correction?.completed !== undefined) {
        watch.completed = correction.completed;
        watch.completionBasis = "imported";
      }
      if (correction?.rewatch !== undefined) watch.rewatch = correction.rewatch;
      if (correction?.watchedAt) {
        watch.dateCorrected = true;
        watch.start = correction.watchedAt;
        watch.end = correction.watchedAt;
        watch.accuracy = "accurate";
      }
      // Unknown/estimated dates establish prior viewing, but not a dated rewatch
      // sequence automatically; users can confirm that relationship explicitly.
      if (
        !correction?.hidden &&
        watch.completed &&
        (watch.accuracy === "accurate" ||
          settings.confirmedPriorTitles.includes(normalize(watch.title.name)))
      )
        completedBefore = true;
      if (!correction?.hidden) watches.push(watch);
    }
  }
  return watches.sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
}

/** Timeline activity can span several dates without creating additional watches. */
export function groupHistoryDays(watches: Watch[], timezone: string): [string, Watch[]][] {
  const groups = new Map<string, Watch[]>();
  const add = (day: string, watch: Watch) => {
    const rows = groups.get(day) ?? [];
    rows.push(watch);
    groups.set(day, rows);
  };
  for (const watch of watches) {
    if (!watch.end) {
      add("Watch date unknown", watch);
      continue;
    }
    if (!watch.sessions.length || watch.dateCorrected) {
      add(dayKey(watch.end, timezone), watch);
      continue;
    }
    const byDay = new Map<string, Playback[]>();
    for (const session of watch.sessions) {
      const day = dayKey(session.start, timezone),
        rows = byDay.get(day) ?? [];
      rows.push(session);
      byDay.set(day, rows);
    }
    for (const [day, sessions] of byDay) {
      const finalDay = dayKey(watch.end, timezone),
        last = sessions.reduce((a, b) => (a.end > b.end ? a : b));
      add(day, {
        ...watch,
        sessions,
        measuredSeconds: sessions.reduce((sum, s) => sum + s.seconds, 0),
        end: last.end,
        completed: watch.completed && day >= finalDay,
        coverage: day < finalDay ? null : watch.coverage,
      });
    }
  }
  return [...groups].sort(([a], [b]) => {
    const datedA = /^\d/.test(a),
      datedB = /^\d/.test(b);
    return datedA !== datedB ? (datedA ? -1 : 1) : b.localeCompare(a);
  });
}

export function mergeTitle(previous: Title | undefined, title: Title): Title {
  return {
    ...title,
    ids: { ...previous?.ids, ...title.ids },
    year: title.year ?? previous?.year,
    poster: title.poster ?? previous?.poster,
    status: title.status ?? previous?.status,
    rating: title.rating ?? previous?.rating,
    latestEpisode: title.latestEpisode ?? previous?.latestEpisode,
  };
}

export function simklPoster(path: string | undefined): string | null {
  return path && /^\d+\/[a-zA-Z0-9]+$/.test(path)
    ? `https://simkl.in/posters/${path}_c.webp`
    : null;
}

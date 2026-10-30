import { type Accuracy, type HistoryEntry, type Title, record, validDate } from "./engine";
export interface ImportedRecord {
  kind: string;
  sourceKey: string;
  payload: Record<string, unknown>;
}
const statuses: Record<string, string> = {
  plantowatch: "planned",
  "plan to watch": "planned",
  hold: "on-hold",
  "on hold": "on-hold",
  completed: "completed",
  watching: "watching",
  dropped: "dropped",
};
export function status(value: unknown): string {
  return typeof value === "string" ? (statuses[value.toLowerCase()] ?? "planned") : "planned";
}
function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function number(value: unknown): number | undefined {
  const n = Number(value);
  return value !== null && value !== "" && Number.isFinite(n) ? n : undefined;
}
function importedDate(value: unknown): { watchedAt: string | null; accuracy: Accuracy } {
  const watchedAt = validDate(value);
  return { watchedAt, accuracy: watchedAt ? "accurate" : "unknown" };
}
export function parseSimklJson(input: unknown): ImportedRecord[] {
  const root = record(input);
  if (!root || ![root.shows, root.movies, root.anime].some(Array.isArray))
    throw new Error("Expected a SIMKL JSON backup containing shows, movies, or anime.");
  const output: ImportedRecord[] = [];
  for (const [section, media, kind] of [
    ["shows", "show", "tv"],
    ["movies", "movie", "movie"],
    ["anime", "show", "anime"],
  ] as const) {
    const entries = root[section];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const row = record(entry),
        titleRow = record(row?.[media]),
        idsRow = record(titleRow?.ids);
      if (!row || !titleRow || !idsRow) continue;
      const id = string(idsRow.simkl);
      if (!id) continue;
      const title: Title = {
        key: `simkl:${id}`,
        name: string(titleRow.title),
        kind,
        year: number(titleRow.year),
        ids: Object.fromEntries(
          Object.entries(idsRow)
            .filter(([, v]) => typeof v === "string" || typeof v === "number")
            .map(([k, v]) => [k, string(v)]),
        ),
        status: status(row.status),
        rating: number(row.user_rating),
        poster: string(titleRow.poster),
        latestEpisode: string(row.last_watched),
      };
      if (!title.name) continue;
      const runtime = Math.max(0, (number(titleRow.runtime) ?? 0) * 60),
        history: HistoryEntry[] = [];
      if (kind === "movie" && row.status === "completed")
        history.push({
          key: title.key,
          title,
          originalWatchedAt: validDate(row.last_watched_at),
          ...importedDate(row.last_watched_at),
          runtime,
          completed: true,
          source: "simkl",
        });
      if (Array.isArray(row.seasons))
        for (const rawSeason of row.seasons) {
          const season = record(rawSeason);
          if (!season || !Array.isArray(season.episodes)) continue;
          for (const rawEp of season.episodes) {
            const ep = record(rawEp),
              seasonNumber = number(season.number),
              episode = number(ep?.number);
            if (!ep || seasonNumber === undefined || episode === undefined) continue;
            history.push({
              key: `${title.key}:s${seasonNumber}:e${episode}`,
              title,
              originalWatchedAt: validDate(ep.watched_at),
              season: seasonNumber,
              episode,
              ...importedDate(ep.watched_at),
              runtime,
              completed: true,
              source: "simkl",
            });
          }
        }
      output.push({
        kind: "simkl-json",
        sourceKey: title.key,
        payload: { title, history },
      });
    }
  }
  if (!output.length) throw new Error("No usable SIMKL titles found.");
  return output;
}
// A small RFC4180 reader avoids silently breaking quoted commas and notes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field.");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function parseSimklCsv(text: string): ImportedRecord[] {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!header?.includes("SIMKL_ID") || !header.includes("Title"))
    throw new Error("Expected SIMKL CSV columns SIMKL_ID and Title.");
  return rows.flatMap((cells) => {
    const r = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    if (!r.SIMKL_ID || !r.Title) return [];
    const title: Title = {
      key: `simkl:${r.SIMKL_ID}`,
      name: r.Title,
      kind: r.Type === "movie" ? "movie" : r.Type === "anime" ? "anime" : "tv",
      year: number(r.Year),
      ids: Object.fromEntries(
        [
          ["simkl", r.SIMKL_ID],
          ["imdb", r.IMDB],
          ["tmdb", r.TMDB],
          ["tvdb", r.TVDB],
        ].filter(([, v]) => Boolean(v)),
      ),
      status: status(r.Watchlist),
      rating: number(r.Rating),
      latestEpisode: r.LastEpWatched,
    };
    // A last-episode CSV summary never invents dates for intervening episodes.
    return [{ kind: "simkl-csv", sourceKey: title.key, payload: { title } }];
  });
}

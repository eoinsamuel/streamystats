import type { Item } from "@streamystats/database";
import { normalize, type Watch } from "./engine";
import type { ImportedStatisticEvent } from "./imported-statistics";

export interface RecordedRankingItem extends Item {
  totalPlayCount: number;
  totalPlayDuration: number;
  importedWatchCount?: number;
  importedWatchSeconds?: number;
}
export interface ImportedRankingItem {
  imported: true;
  sourceLabel: "Manual" | "Imported" | "Logged/imported";
  id: string;
  name: string;
  type: "Movie" | "Episode" | "Series";
  productionYear: number | null;
  seriesName: string | null;
  seasonName: string | null;
  parentIndexNumber: number | null;
  indexNumber: number | null;
  poster?: string;
  totalPlayCount: number;
  totalPlayDuration: number;
  importedWatchCount: number;
  importedWatchSeconds: number;
  titleKey: string;
}
export type DashboardRankingItem = RecordedRankingItem | ImportedRankingItem;
export interface DashboardRankings {
  Movie: DashboardRankingItem[];
  Episode: DashboardRankingItem[];
  Series: DashboardRankingItem[];
}
function matches(item: DashboardRankingItem, watch: Watch, type: "Movie" | "Episode" | "Series") {
  if ("imported" in item)
    return (
      item.titleKey === watch.title.key &&
      (type !== "Episode" ||
        (item.parentIndexNumber === watch.season && item.indexNumber === watch.episode))
    );
  if (type === "Episode")
    return (
      normalize(item.seriesName ?? "") === normalize(watch.title.name) &&
      item.parentIndexNumber === watch.season &&
      item.indexNumber === watch.episode
    );
  const ids = new Map(
    Object.entries(item.providerIds ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  if (
    Object.entries(watch.title.ids ?? {}).some(
      ([key, value]) => ids.get(key.toLowerCase()) === value,
    )
  )
    return true;
  return (
    normalize(item.name) === normalize(watch.title.name) &&
    (!item.productionYear || !watch.title.year || item.productionYear === watch.title.year)
  );
}
export function mergeImportedRankings(
  recorded: DashboardRankings,
  imported: ImportedStatisticEvent[],
): DashboardRankings {
  const result: DashboardRankings = {
    Movie: [...recorded.Movie],
    Episode: [...recorded.Episode],
    Series: [...recorded.Series],
  };
  for (const event of imported) {
    const { watch, seconds } = event;
    const types: ("Movie" | "Episode" | "Series")[] =
      watch.title.kind === "movie" ? ["Movie"] : ["Episode", "Series"];
    for (const type of types) {
      const candidates = result[type].filter((item) => matches(item, watch, type));
      const before = candidates.length === 1 ? candidates[0] : undefined;
      if (before) {
        const index = result[type].indexOf(before);
        result[type][index] = {
          ...before,
          ...("imported" in before &&
          before.sourceLabel !== (watch.sources.includes("manual") ? "Manual" : "Imported")
            ? { sourceLabel: "Logged/imported" as const }
            : {}),
          totalPlayCount: before.totalPlayCount + 1,
          totalPlayDuration: before.totalPlayDuration + seconds,
          importedWatchCount: (before.importedWatchCount ?? 0) + 1,
          importedWatchSeconds: (before.importedWatchSeconds ?? 0) + seconds,
        };
      } else {
        result[type].push({
          imported: true,
          sourceLabel: watch.sources.includes("manual") ? "Manual" : "Imported",
          id: `ledger:${watch.title.key}:${type}:${type === "Episode" ? `${watch.season}:${watch.episode}` : ""}`,
          titleKey: watch.title.key,
          type,
          name: type === "Episode" ? watch.episodeTitle : watch.title.name,
          productionYear: watch.title.year ?? null,
          seriesName: type === "Episode" ? watch.title.name : null,
          seasonName: type === "Episode" ? `Season ${watch.season ?? "?"}` : null,
          parentIndexNumber: watch.season ?? null,
          indexNumber: watch.episode ?? null,
          poster: event.remotePosters ? watch.title.poster : undefined,
          totalPlayCount: 1,
          totalPlayDuration: seconds,
          importedWatchCount: 1,
          importedWatchSeconds: seconds,
        });
      }
    }
  }
  for (const type of ["Movie", "Episode", "Series"] as const)
    result[type].sort((a, b) => b.totalPlayDuration - a.totalPlayDuration);
  return {
    Movie: result.Movie.slice(0, 10),
    Episode: result.Episode.slice(0, 10),
    Series: result.Series.slice(0, 10),
  };
}

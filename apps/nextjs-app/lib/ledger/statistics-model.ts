import type { Watch } from "./engine";

export function isImportedWatch(watch: Watch): boolean {
  return (
    watch.sessions.length === 0 &&
    (watch.sources.includes("simkl") || watch.sources.includes("manual"))
  );
}

export function watchesForStatistics(watches: Watch[], includeImported: boolean): Watch[] {
  return includeImported
    ? watches
    : watches.filter(
        (watch) =>
          !(
            isImportedWatch(watch) &&
            (watch.sources.includes("simkl") || watch.accuracy === "estimated")
          ),
      );
}

export function importedContributions(watches: Watch[]) {
  // Matched Jellyfin/import records have zero imported runtime, so they cannot double count.
  return watches
    .filter((watch) => isImportedWatch(watch) && watch.completed && watch.estimatedSeconds > 0)
    .map((watch) => ({ watch, seconds: watch.estimatedSeconds }));
}

export interface LibraryTitle {
  name: string;
  year: number | null;
  kind: "movie" | "tv";
  ids: Record<string, string> | null;
  allowed: boolean;
}
export function importVisibleInLibraries(watch: Watch, catalog: LibraryTitle[]): boolean {
  const compatible = catalog.filter(
    (title) => (title.kind === "movie") === (watch.title.kind === "movie"),
  );
  const byId = compatible.filter((title) => {
    const ids = new Map(
      Object.entries(title.ids ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    return Object.entries(watch.title.ids ?? {}).some(
      ([key, value]) => Boolean(value) && ids.get(key.toLowerCase()) === value,
    );
  });
  const matches = byId.length
    ? byId
    : compatible.filter(
        (title) =>
          title.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") ===
            watch.title.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") &&
          (!title.year || !watch.title.year || title.year === watch.title.year),
      );
  // Personal titles outside Jellyfin have no library to exclude.
  return !matches.length || matches.some((title) => title.allowed);
}

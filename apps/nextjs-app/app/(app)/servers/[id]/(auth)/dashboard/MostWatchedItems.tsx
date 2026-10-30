"use client";

import type { DashboardRankingItem, DashboardRankings } from "@/lib/ledger/ranking-model";
import { simklPoster } from "@/lib/ledger/engine";
import { Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { usePersistantState } from "@/hooks/usePersistantState";
import type { ServerPublic } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { Poster } from "./Poster";

interface Props {
  data: DashboardRankings;
  server: ServerPublic;
}

// Local storage key
const _STORAGE_KEY = "mostWatchedColumnsVisibility";

// Default column visibility state
const DEFAULT_VISIBILITY = {
  movies: true,
  series: true,
  episodes: true,
};

export const MostWatchedItems: React.FC<Props> = ({ data, server }) => {
  const [_initialized, _setInitialized] = useState(false);

  const [visibleColumns, setVisibleColumns] = usePersistantState<typeof DEFAULT_VISIBILITY>(
    "mostWatchedColumnsVisibility",
    DEFAULT_VISIBILITY,
  );

  const toggleColumn = (column: "movies" | "series" | "episodes") => {
    setVisibleColumns((prev) => ({
      ...prev,
      [column]: !prev[column],
    }));
  };

  // Calculate number of visible columns for grid
  const visibleColumnCount = Object.values(visibleColumns).filter(Boolean).length;
  const gridColsClass =
    visibleColumnCount === 1
      ? "md:grid-cols-1"
      : visibleColumnCount === 2
        ? "md:grid-cols-2"
        : "md:grid-cols-3";

  const renderItems = (
    items: DashboardRankingItem[],
    type: "Movie" | "Episode" | "Series",
    title: string,
  ) => (
    <div className="min-w-0">
      <h2 className="text-xl font-bold mb-4 truncate">Most Watched {title}</h2>
      {items.length === 0 && (
        <p className="text-neutral-500">No {title.toLowerCase()} watched yet.</p>
      )}
      <div className="flex flex-col gap-2">
        {items?.slice(0, 5).map((item, index) => {
          const content = (
            <div
              className="flex flex-row items-center px-2 py-2 rounded-lg border border-border bg-card shadow-sm duration-200 hover:bg-accent/60 group"
              style={{ textDecoration: "none" }}
            >
              <div className="rounded-lg overflow-hidden w-16 transition-transform duration-200">
                {"imported" in item ? (
                  simklPoster(item.poster) ? (
                    <img
                      src={simklPoster(item.poster) ?? ""}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-xs p-1">{item.sourceLabel}</span>
                  )
                ) : (
                  <Poster item={item} server={server} preferredImageType="Primary" />
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="flex flex-row items-center justify-between space-y-0 py-1 px-2 relative">
                  <div className="text-sm">
                    {item.type === "Episode" && (
                      <div className="flex gap-0.5 flex-col">
                        <p className="text-xs text-neutral-500 font-normal truncate">
                          {item.seriesName}
                          {" - "}
                          <span className="text-xs text-neutral-500 font-normal truncate">
                            {`${item.seasonName} - E${item.indexNumber}`}
                          </span>
                        </p>
                        <p className="truncate">{item.name}</p>
                      </div>
                    )}
                    {item.type === "Movie" && (
                      <div className="flex flex-col gap-0.5">
                        <p className="truncate">{item.name}</p>
                        <p className="text-xs text-neutral-500 font-normal">
                          {item.productionYear}
                        </p>
                      </div>
                    )}
                    {item.type === "Series" && (
                      <div className="flex flex-col gap-0.5">
                        <p className="truncate">{item.name}</p>
                        <p className="text-xs text-neutral-500 font-normal">
                          {item.productionYear}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="pt-0 pb-2 px-2">
                  <p className="text-xs font-semibold">
                    {formatDuration(item.totalPlayDuration || 0)}
                  </p>
                  <p className="text-neutral-500 text-xs">
                    {"imported" in item
                      ? `${item.totalPlayCount} ${item.sourceLabel.toLowerCase()} watches`
                      : `${item.totalPlayCount} plays`}
                    {!!item.importedWatchCount && !("imported" in item) && (
                      <span> · {item.importedWatchCount} logged/imported</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          );
          return "imported" in item ? (
            <div key={`${type}-${item.id}-${index}`}>{content}</div>
          ) : (
            <Link
              href={`/servers/${server.id}/library/${item.id}`}
              key={`${type}-${item.id}-${index}`}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className={`grid ${gridColsClass} gap-4`}>
        {visibleColumns.movies && renderItems(data?.Movie || [], "Movie", "Movies")}
        {visibleColumns.series && renderItems(data?.Series || [], "Series", "Series")}
        {visibleColumns.episodes && renderItems(data?.Episode || [], "Episode", "Episodes")}
      </div>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto">
              <Settings className="h-4 w-4 mr-2" /> Display Options
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Visible Sections</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="p-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">Movies</span>
                <Switch
                  checked={visibleColumns.movies}
                  onCheckedChange={() => toggleColumn("movies")}
                />
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">Series</span>
                <Switch
                  checked={visibleColumns.series}
                  onCheckedChange={() => toggleColumn("series")}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Episodes</span>
                <Switch
                  checked={visibleColumns.episodes}
                  onCheckedChange={() => toggleColumn("episodes")}
                />
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setVisibleColumns(DEFAULT_VISIBILITY)}
              className="justify-center text-xs text-muted-foreground"
            >
              Reset to default
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

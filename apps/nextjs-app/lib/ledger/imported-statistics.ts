import "server-only";
import { db, ledgerRecords, users, items, sessions } from "@streamystats/database";
import { and, or, eq, inArray, notInArray, sql } from "drizzle-orm";
import { cache } from "react";
import { getStatisticsExclusions } from "@/lib/db/exclusions";
import {
  importedContributions,
  importVisibleInLibraries,
  type LibraryTitle,
} from "./statistics-model";
import { getWatchLedger } from "./store";
import { record } from "./engine";
import type { Watch } from "./engine";

export interface ImportedStatisticEvent {
  userId: string;
  userName: string;
  watch: Watch;
  seconds: number;
  day: string | null;
  hour: number | null;
  remotePosters: boolean;
}
type EventScope = { serverId: number | string; userId?: string | number; viewerUserId?: string };
const requestEvents = cache(() => new Map<string, Promise<ImportedStatisticEvent[]>>());
export async function getImportedStatisticEvents(scope: EventScope) {
  const key = JSON.stringify(scope),
    entries = requestEvents();
  let result = entries.get(key);
  if (!result) {
    result = readImportedStatisticEvents(scope);
    entries.set(key, result);
  }
  return result;
}
async function readImportedStatisticEvents({
  serverId,
  userId,
  viewerUserId,
}: {
  serverId: number | string;
  userId?: string | number;
  viewerUserId?: string;
}): Promise<ImportedStatisticEvent[]> {
  const id = Number(serverId),
    selected = viewerUserId ?? (userId === undefined ? undefined : String(userId));
  const exclusions = await getStatisticsExclusions(id, viewerUserId);
  const eligible = await db
    .selectDistinct({ id: ledgerRecords.userId, name: users.name })
    .from(ledgerRecords)
    .innerJoin(users, and(eq(users.id, ledgerRecords.userId), eq(users.serverId, id)))
    .where(
      and(
        eq(ledgerRecords.serverId, id),
        or(
          eq(ledgerRecords.kind, "manual"),
          and(
            eq(ledgerRecords.kind, "settings"),
            eq(sql<string>`${ledgerRecords.payload}->>'includeImportedStats'`, "true"),
          ),
        ),
        selected ? eq(ledgerRecords.userId, selected) : undefined,
        exclusions.excludedUserIds.length
          ? notInArray(ledgerRecords.userId, exclusions.excludedUserIds)
          : undefined,
      ),
    )
    .limit(101);
  if (eligible.length > 100)
    throw new Error("Imported statistics currently support 100 enabled accounts per server.");
  const catalog: LibraryTitle[] = [];
  if (exclusions.hasLibraryExclusions) {
    const metadata = await db
      .select({
        name: items.name,
        year: items.productionYear,
        type: items.type,
        ids: items.providerIds,
        libraryId: items.libraryId,
      })
      .from(items)
      .where(and(eq(items.serverId, id), inArray(items.type, ["Movie", "Series"])))
      .limit(50001);
    if (metadata.length > 50000)
      throw new Error("Library-filtered imported statistics support 50,000 catalog titles.");
    for (const item of metadata)
      catalog.push({
        name: item.name,
        year: item.year,
        kind: item.type === "Movie" ? "movie" : "tv",
        ids: Object.fromEntries(
          Object.entries(record(item.ids) ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
        allowed:
          exclusions.allowedLibraryIds !== null
            ? exclusions.allowedLibraryIds.includes(item.libraryId)
            : !exclusions.excludedLibraryIds.includes(item.libraryId),
      });
  }
  const events: ImportedStatisticEvent[] = [];
  for (const user of eligible) {
    // A newly persisted session must invalidate overlap matching immediately,
    // even when the general history page still has its short-lived cache.
    const [revision] = await db
      .select({
        count: sql<string>`COUNT(*)::text`,
        last: sql<string | null>`MAX(${sessions.endTime})::text`,
      })
      .from(sessions)
      .where(and(eq(sessions.serverId, id), eq(sessions.userId, user.id)));
    const ledger = await getWatchLedger({
      serverId: id,
      userId: user.id,
      revision: `${revision?.count}:${revision?.last}`,
    });
    for (const { watch, seconds } of importedContributions(ledger.watches)) {
      if (
        !ledger.settings.includeImportedStats &&
        (watch.sources.includes("simkl") || watch.accuracy === "estimated")
      )
        continue;
      if (!importVisibleInLibraries(watch, catalog)) continue;
      const date = watch.end ? new Date(watch.end) : null;
      events.push({
        userId: user.id,
        userName: user.name,
        watch,
        seconds,
        day: date?.toISOString().slice(0, 10) ?? null,
        hour: date?.getUTCHours() ?? null,
        remotePosters: ledger.settings.remotePosters,
      });
    }
  }
  return events;
}
export function filterImportedEvents({
  events,
  startDate,
  endDate,
}: {
  events: ImportedStatisticEvent[];
  startDate?: string | Date;
  endDate?: string | Date;
}) {
  const start = startDate ? new Date(startDate) : null,
    end = endDate ? new Date(endDate) : null;
  if (end && typeof endDate === "string" && !endDate.includes("T"))
    end.setUTCHours(23, 59, 59, 999);
  return events.filter((event) => {
    if (!event.watch.end) return !start && !end;
    const time = Date.parse(event.watch.end);
    return (!start || time >= start.getTime()) && (!end || time <= end.getTime());
  });
}
export async function getImportedStatistics({
  serverId,
  userId,
  viewerUserId,
  startDate,
  endDate,
}: {
  serverId: number | string;
  userId?: string | number;
  viewerUserId?: string;
  startDate?: string | Date;
  endDate?: string | Date;
}) {
  return filterImportedEvents({
    events: await getImportedStatisticEvents({ serverId, userId, viewerUserId }),
    startDate,
    endDate,
  });
}
export async function getImportedStatisticsForUsers(userIds: string[]) {
  if (!userIds.length) return [];
  const rows = await db
    .select({ id: users.id, serverId: users.serverId })
    .from(users)
    .where(inArray(users.id, userIds));
  const result: ImportedStatisticEvent[] = [];
  for (const id of new Set(rows.map((row) => row.serverId))) {
    const allowed = new Set(rows.filter((row) => row.serverId === id).map((row) => row.id));
    result.push(
      ...(await getImportedStatisticEvents({ serverId: id })).filter((event) =>
        allowed.has(event.userId),
      ),
    );
  }
  return result;
}
export async function getIncludeImportedPreference({
  serverId,
  userId,
}: {
  serverId: number;
  userId: string;
}) {
  const [row] = await db
    .select({ payload: ledgerRecords.payload })
    .from(ledgerRecords)
    .where(
      and(
        eq(ledgerRecords.serverId, serverId),
        eq(ledgerRecords.userId, userId),
        eq(ledgerRecords.kind, "settings"),
      ),
    )
    .limit(1);
  return row?.payload.includeImportedStats === true;
}

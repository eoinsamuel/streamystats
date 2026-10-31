"use server";

import "server-only";

import { db, items, sessions, type User, users } from "@streamystats/database";
import { and, eq, gte, inArray, isNotNull, lte, type SQL, sql, sum } from "drizzle-orm";
import {
  getImportedStatistics,
  getImportedStatisticsForUsers,
} from "@/lib/ledger/imported-statistics";
import { cache } from "react";
import { cookies } from "next/headers";
import { jellyfinHeaders } from "@/lib/jellyfin-auth";
import { getInternalUrl } from "../server-url";
import { destroySession, getSession } from "../session";
import { getStatisticsExclusions } from "./exclusions";
import { isBetterDisplayName, normalizeGenre } from "./genres";
import { getServer } from "./server";

interface JellyfinUser {
  Id: string;
  Name: string;
  // IsAdministrator: boolean;
  IsDisabled: boolean;
  Policy: {
    IsAdministrator: boolean;
  };
  // Add other fields as needed
}

export const getUser = async ({
  name,
  serverId,
}: {
  name: string;
  serverId: string | number;
}): Promise<User | null> => {
  const user = await db.query.users.findFirst({
    where: and(eq(users.name, name), eq(users.serverId, Number(serverId))),
  });
  return user || null;
};

export const getUserById = async ({
  userId,
  serverId,
}: {
  userId: string;
  serverId: string | number;
}): Promise<User | null> => {
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, userId), eq(users.serverId, Number(serverId))),
  });
  return user || null;
};

export const getUsers = async ({ serverId }: { serverId: string | number }): Promise<User[]> => {
  return await db.query.users.findMany({
    where: eq(users.serverId, Number(serverId)),
  });
};

export interface WatchTimePerWeekDay {
  day: string;
  watchTime: number;
}

function getStartDateConstraint(startDate?: string) {
  if (!startDate) return undefined;
  const start = new Date(startDate);
  if (!startDate.includes("T")) {
    start.setHours(0, 0, 0, 0);
  }
  return start;
}

function getEndDateConstraint(endDate?: string) {
  if (!endDate) return undefined;
  const end = new Date(endDate);
  if (!endDate.includes("T")) {
    end.setHours(23, 59, 59, 999);
  }
  return end;
}

export const getWatchTimePerWeekDay = async ({
  serverId,
  userId,
  startDate,
  endDate,
  viewerUserId,
}: {
  serverId: string | number;
  userId?: string | number;
  startDate?: string;
  endDate?: string;
  viewerUserId?: string;
}): Promise<WatchTimePerWeekDay[]> => {
  const start = getStartDateConstraint(startDate);
  const end = getEndDateConstraint(endDate);

  // Get exclusion settings
  const { userExclusion, itemLibraryExclusion } = await getStatisticsExclusions(
    Number(serverId),
    viewerUserId,
  );

  // Build the where condition based on whether userId is provided
  const whereConditions: SQL[] = [eq(sessions.serverId, Number(serverId))];
  if (userId !== undefined) {
    whereConditions.push(eq(sessions.userId, String(userId)));
  }
  if (start) {
    whereConditions.push(gte(sessions.startTime, start));
  }
  if (end) {
    whereConditions.push(lte(sessions.startTime, end));
  }

  // Add exclusion filters
  if (userExclusion) {
    whereConditions.push(userExclusion);
  }
  if (itemLibraryExclusion) {
    whereConditions.push(itemLibraryExclusion);
  }

  // Use SQL GROUP BY for aggregation instead of fetching all rows
  const result = await db
    .select({
      weekDay: sql<string>`TRIM(TO_CHAR(${sessions.startTime}, 'Day'))`.as("weekDay"),
      watchTime: sum(sessions.playDuration).as("watchTime"),
    })
    .from(sessions)
    .innerJoin(items, eq(sessions.itemId, items.id))
    .where(and(...whereConditions))
    .groupBy(sql`TRIM(TO_CHAR(${sessions.startTime}, 'Day'))`);

  // Convert to map for easy lookup
  const resultMap: Record<string, number> = {};
  for (const row of result) {
    if (row.weekDay) {
      resultMap[row.weekDay] = Number(row.watchTime || 0);
    }
  }

  for (const event of await getImportedStatistics({
    serverId,
    userId,
    viewerUserId,
    startDate,
    endDate,
  })) {
    if (!event.watch.end) continue;
    const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(
      new Date(event.watch.end),
    );
    resultMap[day] = (resultMap[day] ?? 0) + event.seconds;
  }
  // Return ordered array (Monday-Sunday)
  const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  return daysOfWeek.map((day) => ({
    day,
    watchTime: resultMap[day] || 0,
  }));
};

export interface WatchTimePerHour {
  hour: number;
  watchTime: number;
}

export const getWatchTimePerHour = async ({
  serverId,
  userId,
  startDate,
  endDate,
  viewerUserId,
}: {
  serverId: string | number;
  userId?: string | number;
  startDate?: string;
  endDate?: string;
  viewerUserId?: string;
}): Promise<WatchTimePerHour[]> => {
  const start = getStartDateConstraint(startDate);
  const end = getEndDateConstraint(endDate);

  // Get exclusion settings
  const { userExclusion, itemLibraryExclusion } = await getStatisticsExclusions(
    Number(serverId),
    viewerUserId,
  );

  // Build the where condition based on whether userId is provided
  const whereConditions: SQL[] = [eq(sessions.serverId, Number(serverId))];
  if (userId !== undefined) {
    whereConditions.push(eq(sessions.userId, String(userId)));
  }
  if (start) {
    whereConditions.push(gte(sessions.startTime, start));
  }
  if (end) {
    whereConditions.push(lte(sessions.startTime, end));
  }

  // Add exclusion filters
  if (userExclusion) {
    whereConditions.push(userExclusion);
  }
  if (itemLibraryExclusion) {
    whereConditions.push(itemLibraryExclusion);
  }

  // Use SQL GROUP BY for aggregation instead of fetching all rows
  const result = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM ${sessions.startTime})`.as("hour"),
      watchTime: sum(sessions.playDuration).as("watchTime"),
    })
    .from(sessions)
    .innerJoin(items, eq(sessions.itemId, items.id))
    .where(and(...whereConditions))
    .groupBy(sql`EXTRACT(HOUR FROM ${sessions.startTime})`)
    .orderBy(sql`EXTRACT(HOUR FROM ${sessions.startTime})`);

  const hours = new Map(result.map((row) => [Number(row.hour), Number(row.watchTime ?? 0)]));
  for (const event of await getImportedStatistics({
    serverId,
    userId,
    viewerUserId,
    startDate,
    endDate,
  }))
    if (event.hour !== null) hours.set(event.hour, (hours.get(event.hour) ?? 0) + event.seconds);
  return [...hours].sort(([a], [b]) => a - b).map(([hour, watchTime]) => ({ hour, watchTime }));
};

export const getTotalWatchTime = async ({
  serverId,
  userId,
  startDate,
  endDate,
  viewerUserId,
}: {
  serverId: string | number;
  userId?: string | number;
  startDate?: string;
  endDate?: string;
  viewerUserId?: string;
}): Promise<number> => {
  const start = getStartDateConstraint(startDate);
  const end = getEndDateConstraint(endDate);

  // Get exclusion settings
  const { userExclusion, itemLibraryExclusion } = await getStatisticsExclusions(
    Number(serverId),
    viewerUserId,
  );

  // Build the where condition based on whether userId is provided
  const whereConditions: SQL[] = [eq(sessions.serverId, Number(serverId))];
  if (userId !== undefined) {
    whereConditions.push(eq(sessions.userId, String(userId)));
  }
  if (start) {
    whereConditions.push(gte(sessions.startTime, start));
  }
  if (end) {
    whereConditions.push(lte(sessions.startTime, end));
  }

  // Add exclusion filters
  if (userExclusion) {
    whereConditions.push(userExclusion);
  }
  if (itemLibraryExclusion) {
    whereConditions.push(itemLibraryExclusion);
  }

  const result = await db
    .select({
      playDuration: sum(sessions.playDuration),
    })
    .from(sessions)
    .innerJoin(items, eq(sessions.itemId, items.id))
    .where(and(...whereConditions));

  const imported = await getImportedStatistics({
    serverId,
    userId,
    viewerUserId,
    startDate,
    endDate,
  });
  return (
    Number(result[0]?.playDuration || 0) + imported.reduce((sum, event) => sum + event.seconds, 0)
  );
};

interface UserWithWatchTime {
  [key: string]: number;
}

export const getTotalWatchTimeForUsers = async ({
  userIds,
}: {
  userIds: string[] | number[];
}): Promise<UserWithWatchTime> => {
  if (userIds.length === 0) {
    return {};
  }

  const stringUserIds = userIds.map((id) => String(id));

  const results = await db
    .select({
      userId: sessions.userId,
      totalWatchTime: sum(sessions.playDuration),
    })
    .from(sessions)
    .where(inArray(sessions.userId, stringUserIds))
    .groupBy(sessions.userId);

  const watchTimeMap: UserWithWatchTime = {};

  for (const result of results) {
    if (result.userId) {
      watchTimeMap[result.userId] = Number(result.totalWatchTime || 0);
    }
  }

  // Ensure all requested users are included, even if they have no sessions
  for (const userId of stringUserIds) {
    if (!(userId in watchTimeMap)) {
      watchTimeMap[userId] = 0;
    }
  }

  for (const event of await getImportedStatisticsForUsers(stringUserIds))
    watchTimeMap[event.userId] = (watchTimeMap[event.userId] ?? 0) + event.seconds;
  return watchTimeMap;
};

export type UserActivityPerDay = Record<string, number>;

export const getUserActivityPerDay = async ({
  serverId,
  startDate,
  endDate,
  viewerUserId,
}: {
  serverId: string | number;
  startDate: string;
  endDate: string;
  viewerUserId?: string;
}): Promise<UserActivityPerDay> => {
  // Get exclusion settings
  const { userExclusion } = await getStatisticsExclusions(Number(serverId), viewerUserId);

  const whereConditions: SQL[] = [
    eq(sessions.serverId, Number(serverId)),
    gte(sessions.startTime, new Date(startDate)),
    lte(sessions.startTime, new Date(endDate)),
  ];

  // Add exclusion filters
  if (userExclusion) {
    whereConditions.push(userExclusion);
  }

  // Get sessions with date and user information
  const sessionData = await db
    .select({
      date: sql<string>`DATE(${sessions.startTime})`.as("date"),
      userId: sessions.userId,
    })
    .from(sessions)
    .where(and(...whereConditions));

  // Group by date and count distinct users manually
  const activityMap: UserActivityPerDay = {};
  const dateUserSets: Record<string, Set<string>> = {};

  for (const session of sessionData) {
    if (session.date && session.userId) {
      if (!dateUserSets[session.date]) {
        dateUserSets[session.date] = new Set();
      }
      dateUserSets[session.date].add(session.userId);
    }
  }

  for (const event of await getImportedStatistics({ serverId, viewerUserId, startDate, endDate })) {
    if (!event.day) continue;
    (dateUserSets[event.day] ??= new Set()).add(event.userId);
  }
  // Convert sets to counts
  for (const [date, userSet] of Object.entries(dateUserSets)) {
    activityMap[date] = userSet.size;
  }

  return activityMap;
};

export const logout = async (): Promise<void> => {
  await destroySession();
};

/**
 * Gets the current user from the signed session cookie.
 * The session is cryptographically signed, so it cannot be tampered with.
 */
export const getMe = async (): Promise<User | null> => {
  const session = await getSession();
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    name: session.name,
    serverId: session.serverId,
  } as User;
};

/**
 * Verify current privileges before returning server-wide statistics.
 */
export const isUserAdmin = async (serverId?: number | string): Promise<boolean> => {
  const session = await getSession();
  if (!session?.isAdmin) return false;
  if (
    serverId !== undefined &&
    serverId !== null &&
    Number(session.serverId) !== Number(serverId)
  ) {
    return false;
  }
  return await checkedAdmin();
};

/**
 * Get the viewer user ID for library access filtering.
 * Returns undefined for admins (no restrictions), or the user's ID for non-admins.
 */
export const getViewerUserId = async (): Promise<string | undefined> => {
  const session = await getSession();
  if (!session) return undefined;
  return session.isAdmin && (await checkedAdmin()) ? undefined : session.id;
};

// React cache is request-local; privilege decisions never survive into another request.
const checkedAdmin = cache(async () => validateAdminWithJellyfin());

/**
 * Validates admin status against the live Jellyfin server.
 * Use this for security-critical operations where you need real-time verification.
 */
export const validateAdminWithJellyfin = async (): Promise<boolean> => {
  const session = await getSession();

  if (!session) {
    return false;
  }

  const server = await getServer({ serverId: session.serverId });
  if (!server) {
    return false;
  }

  const c = await cookies();
  const token = c.get("streamystats-token");

  try {
    const response = await fetch(`${getInternalUrl(server)}/Users/Me`, {
      method: "GET",
      cache: "no-store",
      headers: jellyfinHeaders(token?.value || ""),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return false;
    }

    const jellyfinUser: JellyfinUser = await response.json();

    if (jellyfinUser.Id !== session.id) {
      return false;
    }

    return jellyfinUser.Policy.IsAdministrator === true;
  } catch {
    return false;
  }
};

// Server-level statistics functions for admin users

export interface UserStatsSummary {
  userId: string;
  userName: string;
  totalWatchTime: number;
  sessionCount: number;
}

export const getUserStatsSummaryForServer = async ({
  serverId,
  startDate,
  endDate,
  userId,
  itemType,
  viewerUserId,
}: {
  serverId: string | number;
  startDate?: string;
  endDate?: string;
  userId?: string;
  itemType?: "Movie" | "Series" | "Episode" | "all";
  viewerUserId?: string;
}): Promise<UserStatsSummary[]> => {
  // Get exclusion settings
  const { userExclusion, itemLibraryExclusion, requiresItemsJoin } = await getStatisticsExclusions(
    Number(serverId),
    viewerUserId,
  );

  const whereConditions: SQL[] = [
    eq(sessions.serverId, Number(serverId)),
    isNotNull(sessions.startTime),
  ];

  if (startDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    whereConditions.push(gte(sessions.startTime, start));
  }

  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    whereConditions.push(lte(sessions.startTime, end));
  }

  if (userId) {
    whereConditions.push(eq(sessions.userId, userId));
  }

  // Add exclusion filters
  if (userExclusion) {
    whereConditions.push(userExclusion);
  }

  const needsItemTypeFilter = itemType && itemType !== "all" && itemType !== undefined;

  // Need to join items if we have library exclusions OR item type filter
  const needsItemJoin = needsItemTypeFilter || requiresItemsJoin;

  let query = db
    .select({
      userId: sessions.userId,
      userName: users.name,
      totalWatchTime: sum(sessions.playDuration),
      sessionCount: sql<number>`COUNT(${sessions.id})`.as("sessionCount"),
    })
    .from(sessions)
    .leftJoin(users, eq(sessions.userId, users.id));

  if (needsItemJoin) {
    query = query.innerJoin(items, eq(sessions.itemId, items.id));

    if (needsItemTypeFilter) {
      if (itemType === "Series") {
        whereConditions.push(eq(items.type, "Episode"));
      } else {
        whereConditions.push(eq(items.type, itemType));
      }
    }

    whereConditions.push(isNotNull(sessions.itemId));

    // Add library exclusion when joining items
    if (itemLibraryExclusion) {
      whereConditions.push(itemLibraryExclusion);
    }
  }

  const results = await query
    .where(and(...whereConditions))
    .groupBy(sessions.userId, users.name)
    .orderBy(sql`SUM(${sessions.playDuration}) DESC`);

  const summary = results.map(
    (result: {
      userId: string | null;
      userName: string | null;
      totalWatchTime: string | null;
      sessionCount: number;
    }) => ({
      userId: result.userId || "",
      userName: result.userName || "Unknown",
      totalWatchTime: Number(result.totalWatchTime || 0),
      sessionCount: Number(result.sessionCount || 0),
    }),
  );
  const byUser = new Map(summary.map((row) => [row.userId, row]));
  for (const event of await getImportedStatistics({
    serverId,
    userId,
    viewerUserId,
    startDate,
    endDate,
  })) {
    if (
      itemType &&
      itemType !== "all" &&
      (itemType === "Movie") !== (event.watch.title.kind === "movie")
    )
      continue;
    const row = byUser.get(event.userId) ?? {
      userId: event.userId,
      userName: event.userName,
      totalWatchTime: 0,
      sessionCount: 0,
    };
    row.totalWatchTime += event.seconds;
    row.sessionCount++;
    byUser.set(event.userId, row);
  }
  return [...byUser.values()].sort((a, b) => b.totalWatchTime - a.totalWatchTime);
};

export const getServerStatistics = async ({ serverId }: { serverId: string | number }) => {
  const [totalWatchTime, watchTimePerWeekDay, watchTimePerHour, userStatsSummary] =
    await Promise.all([
      getTotalWatchTime({ serverId }),
      getWatchTimePerWeekDay({ serverId }),
      getWatchTimePerHour({ serverId }),
      getUserStatsSummaryForServer({ serverId }),
    ]);

  return {
    totalWatchTime,
    watchTimePerWeekDay,
    watchTimePerHour,
    userStatsSummary,
    totalUsers: userStatsSummary.length,
    totalSessions: userStatsSummary.reduce((sum, user) => sum + user.sessionCount, 0),
  };
};

export interface UserWatchStats {
  total_watch_time: number;
  total_plays: number;
  longest_streak: number;
}

export interface UserWithStats extends User {
  watch_stats: UserWatchStats;
  longest_streak: number;
}

export const getUserWatchStats = async ({
  serverId,
  userId,
}: {
  serverId: string | number;
  userId: string;
}): Promise<UserWatchStats> => {
  if (!userId) {
    throw new Error("userId is required for getUserWatchStats");
  }

  const [totalWatchTime, userSessions] = await Promise.all([
    getTotalWatchTime({ serverId, userId }),
    db
      .select({
        playDuration: sessions.playDuration,
        startTime: sessions.startTime,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.serverId, Number(serverId))))
      .orderBy(sessions.startTime),
  ]);

  const imported = await getImportedStatistics({ serverId, userId });
  const days = [
    ...new Set([
      ...userSessions
        .filter((row) => row.startTime && (row.playDuration ?? 0) > 0)
        .map((row) => row.startTime?.toISOString().slice(0, 10) ?? ""),
      ...imported.flatMap((event) => (event.day ? [event.day] : [])),
    ]),
  ]
    .filter(Boolean)
    .sort();
  let longestStreak = 0,
    currentStreak = 0,
    previous = "";
  for (const day of days) {
    const gap = previous ? (Date.parse(day) - Date.parse(previous)) / 86400000 : 0;
    currentStreak = gap === 1 ? currentStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    previous = day;
  }

  return {
    total_watch_time: totalWatchTime,
    total_plays:
      userSessions.filter(
        (s: { playDuration: number | null }) => s.playDuration && s.playDuration > 0,
      ).length + imported.length,
    longest_streak: longestStreak, // Return the number of days directly
  };
};

export const getUsersWithStats = async ({
  serverId,
}: {
  serverId: string | number;
}): Promise<UserWithStats[]> => {
  const users = await getUsers({ serverId });

  // Get watch stats for all users in parallel
  const userStatsPromises = users.map(async (user) => {
    const watchStats = await getUserWatchStats({ serverId, userId: user.id });
    return {
      ...user,
      watch_stats: watchStats,
      longest_streak: watchStats.longest_streak,
    };
  });

  return Promise.all(userStatsPromises);
};

export interface GenreStat {
  genre: string;
  watchTime: number;
  playCount: number;
}

export const getUserGenreStats = async ({
  userId,
  serverId,
}: {
  userId: string;
  serverId: string | number;
}): Promise<GenreStat[]> => {
  const sessionItems = await db
    .select({
      playDuration: sessions.playDuration,
      genres: items.genres,
    })
    .from(sessions)
    .innerJoin(items, eq(sessions.itemId, items.id))
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.serverId, Number(serverId)),
        inArray(items.type, ["Movie", "Episode", "Series"]),
      ),
    );

  const genreMap: Record<string, { watchTime: number; playCount: number; displayName: string }> =
    {};

  for (const row of sessionItems) {
    if (Array.isArray(row.genres)) {
      for (const genre of row.genres) {
        if (!genre) continue;
        const { key, displayName } = normalizeGenre(genre);
        if (!genreMap[key]) {
          genreMap[key] = { watchTime: 0, playCount: 0, displayName };
        } else if (isBetterDisplayName(genreMap[key].displayName, displayName)) {
          genreMap[key].displayName = displayName;
        }
        genreMap[key].watchTime += row.playDuration || 0;
        genreMap[key].playCount += 1;
      }
    }
  }

  return Object.entries(genreMap).map(([_key, stats]) => ({
    genre: stats.displayName,
    watchTime: stats.watchTime,
    playCount: stats.playCount,
  }));
};

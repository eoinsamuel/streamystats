import type { getWatchLedger } from "./store";
import { dayKey, groupHistoryDays, type Watch, type Title } from "./engine";

type Ledger = Awaited<ReturnType<typeof getWatchLedger>>;
const PAGE_SIZE = 100;
const dayOffset = (day: string, amount: number) => {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};
export function buildLedgerView(ledger: Ledger, query: URLSearchParams) {
  const zone = ledger.settings.timezone,
    today = dayKey(new Date().toISOString(), zone);
  const kind = query.get("kind") ?? "all",
    search = (query.get("search") ?? "").toLowerCase().slice(0, 300);
  const watches = ledger.watches.filter(
    (w) =>
      (kind === "all" || w.title.kind === kind) &&
      `${w.title.name} ${w.episodeTitle}`.toLowerCase().includes(search),
  );
  const completed = watches.filter((w) => w.completed);
  const days = new Map<
    string,
    { day: string; recorded: number; imported: number; count: number }
  >();
  const getDay = (day: string) => {
    let row = days.get(day);
    if (!row) {
      row = { day, recorded: 0, imported: 0, count: 0 };
      days.set(day, row);
    }
    return row;
  };
  for (const watch of watches) {
    for (const session of watch.sessions)
      getDay(dayKey(session.start, zone)).recorded += session.seconds;
    if (watch.accuracy === "accurate" && watch.end) {
      const day = getDay(dayKey(watch.end, zone));
      day.imported += watch.estimatedSeconds;
      if (watch.completed) day.count++;
    }
  }
  const recap = (start: string, end: string) => {
    const matches = (day: string) => day >= start && day < end;
    const rows = [...days.values()].filter((row) => matches(row.day));
    const top = new Map<string, { title: Title; seconds: number; count: number }>();
    for (const watch of watches) {
      let seconds = watch.sessions.reduce(
        (sum, session) => sum + (matches(dayKey(session.start, zone)) ? session.seconds : 0),
        0,
      );
      if (watch.accuracy === "accurate" && watch.end && matches(dayKey(watch.end, zone)))
        seconds += watch.estimatedSeconds;
      if (!seconds) continue;
      const row = top.get(watch.title.key) ?? { title: watch.title, seconds: 0, count: 0 };
      row.seconds += seconds;
      if (watch.completed && watch.end && matches(dayKey(watch.end, zone))) row.count++;
      top.set(watch.title.key, row);
    }
    return {
      recorded: rows.reduce((sum, row) => sum + row.recorded, 0),
      imported: rows.reduce((sum, row) => sum + row.imported, 0),
      count: rows.reduce((sum, row) => sum + row.count, 0),
      active: rows.filter((row) => row.recorded + row.imported > 0).length,
      top: [...top.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 3),
    };
  };
  const monthInput = query.get("month"),
    weekInput = query.get("week");
  const month =
    monthInput && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput) ? monthInput : today.slice(0, 7);
  const monthEnd = new Date(`${month}-01T12:00:00Z`);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const weekDay = new Date(`${today}T12:00:00Z`).getUTCDay();
  const week =
    weekInput && /^\d{4}-\d{2}-\d{2}$/.test(weekInput) && Number.isFinite(Date.parse(weekInput))
      ? weekInput
      : dayOffset(today, -((weekDay + 6) % 7));
  const status = query.get("watchStatus") ?? "all";
  const from = query.get("from") ?? "",
    to = query.get("to") ?? "";
  const cards = groupHistoryDays(
    watches.filter(
      (w) => status === "all" || (status === "completed" ? w.completed : !w.completed),
    ),
    zone,
  )
    .filter(
      ([day]) =>
        !(from || to) || (/^\d{4}/.test(day) && (!from || day >= from) && (!to || day <= to)),
    )
    .flatMap(([day, rows]) => rows.map((watch) => ({ day, watch })));
  const requestedPage = Number(query.get("page") ?? 0);
  const page = Math.max(
    0,
    Math.min(
      Number.isSafeInteger(requestedPage) ? requestedPage : 0,
      Math.max(0, Math.ceil(cards.length / PAGE_SIZE) - 1),
    ),
  );
  const visible = cards.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const grouped = new Map<string, Watch[]>();
  for (const { day, watch } of visible) grouped.set(day, [...(grouped.get(day) ?? []), watch]);
  const ids = new Set(visible.map((row) => row.watch.id));
  const originals = watches.filter((watch) => ids.has(watch.id));
  const sessionIds = new Set(
    originals.flatMap((watch) => watch.sessions.map((session) => session.id)),
  );
  return {
    watches: originals,
    grouped: [...grouped.entries()],
    titles: ledger.titles,
    settings: ledger.settings,
    images: Object.fromEntries(Object.entries(ledger.images).filter(([id]) => sessionIds.has(id))),
    sessionCount: ledger.sessionCount,
    hiddenCount: ledger.hiddenCount,
    totalWatches: ledger.watches.length,
    totals: {
      recorded: watches.reduce((sum, watch) => sum + watch.measuredSeconds, 0),
      imported: watches.reduce((sum, watch) => sum + watch.estimatedSeconds, 0),
      completed: completed.length,
      completedTitles: new Set(completed.map((watch) => watch.title.key)).size,
      rewatches: completed.filter((watch) => watch.rewatch).length,
    },
    days: [...days.values()],
    recaps: {
      month: recap(`${month}-01`, monthEnd.toISOString().slice(0, 10)),
      week: recap(week, dayOffset(week, 7)),
    },
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total: cards.length,
      hasNext: (page + 1) * PAGE_SIZE < cards.length,
    },
  };
}

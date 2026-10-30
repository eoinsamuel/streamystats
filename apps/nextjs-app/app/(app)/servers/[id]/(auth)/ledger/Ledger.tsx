"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
	CalendarDays,
	ChevronDown,
	Clock,
	Film,
	Import,
	Plus,
	Repeat,
	Search,
	Settings2,
	Tv,
	Undo2,
	X,
} from "lucide-react";
import type { getWatchLedger } from "@/lib/ledger/store";
import {
	simklPoster,
	dayKey,
	groupHistoryDays,
	normalize,
	type Title,
	type Watch,
} from "@/lib/ledger/engine";
import { basePath, getJellyfinImageUrl } from "@/lib/utils";
import "./ledger.css";
type Data = Awaited<ReturnType<typeof getWatchLedger>>;
const seconds = (value: number) => {
	const n = Math.max(0, Math.round(value));
	return n >= 3600
		? `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`
		: `${Math.floor(n / 60)}m`;
};
const label = (watch: Watch) =>
	watch.title.kind === "movie"
		? watch.title.name
		: watch.season !== undefined && watch.episode !== undefined
			? `S${String(watch.season).padStart(2, "0")} E${String(watch.episode).padStart(2, "0")} · ${watch.episodeTitle}`
			: watch.episodeTitle;
function Modal({
	children,
	onClose,
	label,
}: {
	children: React.ReactNode;
	onClose: () => void;
	label: string;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		dialog?.showModal();
		return () => dialog?.close();
	}, []);
	return (
		<dialog
			ref={ref}
			className="wl-native-dialog"
			aria-label={label}
			onCancel={(e) => {
				e.preventDefault();
				onClose();
			}}
		>
			{children}
		</dialog>
	);
}
function dateLabel(day: string) {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(new Date(`${day}T12:00:00Z`));
}
function dayOffset(day: string, n: number) {
	const d = new Date(`${day}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}
function Monday(day: string) {
	const d = new Date(`${day}T12:00:00Z`);
	return dayOffset(day, -((d.getUTCDay() + 6) % 7));
}
export function Ledger({
	initial,
	serverId,
	serverUrl,
	selectedUserId,
	availableUsers,
}: {
	initial: Data;
	serverId: number;
	serverUrl: string;
	selectedUserId: string;
	availableUsers: { id: string; name: string }[];
}) {
	const router = useRouter(), pathname = usePathname(), searchParams = useSearchParams();
	const [switching, setSwitching] = useState(false);
	const selectedName = availableUsers.find(user => user.id === selectedUserId)?.name ?? "Selected user";
	const [data, setData] = useState(initial),
		[busy, setBusy] = useState(false),
		[error, setError] = useState(""),
		[message, setMessage] = useState(""),
		[tab, setTab] = useState("history"),
		[kind, setKind] = useState("all"),
		[search, setSearch] = useState(""),
		[from, setFrom] = useState(""),
		[to, setTo] = useState(""),
		[manual, setManual] = useState(false),
		[edit, setEdit] = useState<Watch | null>(null),
		[settings, setSettings] = useState(false),
		[monthOffset, setMonthOffset] = useState(0),
		[weekOffset, setWeekOffset] = useState(0),
		[statusFilter, setStatusFilter] = useState("all");
	const upload = useRef<HTMLInputElement>(null),
		zone = data.settings.timezone;
	const endpoint = `${basePath}/api/ledger?serverId=${serverId}&userId=${encodeURIComponent(selectedUserId)}`;
	async function refresh() {
		const r = await fetch(endpoint, { cache: "no-store" });
		if (!r.ok)
			throw new Error("Unable to refresh history. Please log in again.");
		setData(await r.json());
	}
	async function mutate(body: unknown) {
		setBusy(true);
		setError("");
		try {
			const r = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const result = await r.json();
			if (!r.ok) throw new Error(result.error ?? "Unable to save");
			await refresh();
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Unable to save");
			return false;
		} finally {
			setBusy(false);
		}
	}
	useEffect(() => {
		const timer = setInterval(() => {
			void fetch(endpoint, { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : null))
				.then((v) => {
					if (v) setData(v);
				})
				.catch(() => {});
		}, 60000);
		return () => clearInterval(timer);
	}, [endpoint]);
	const filtered = useMemo(
		() =>
			data.watches.filter(
				(w) =>
					(kind === "all" || w.title.kind === kind) &&
					`${w.title.name} ${w.episodeTitle}`
						.toLowerCase()
						.includes(search.toLowerCase()),
			),
		[data.watches, kind, search],
	);
	const completed = filtered.filter((w) => w.completed),
		rewatches = completed.filter((w) => w.rewatch);
	const recorded = filtered.reduce((s, w) => s + w.measuredSeconds, 0),
		estimated = filtered.reduce((s, w) => s + w.estimatedSeconds, 0);
	const contributions = useMemo(() => {
		const days = new Map<
			string,
			{ recorded: number; estimated: number; watches: Watch[] }
		>();
		const get = (day: string) => {
			let v = days.get(day);
			if (!v) {
				v = { recorded: 0, estimated: 0, watches: [] };
				days.set(day, v);
			}
			return v;
		};
		for (const w of filtered) {
			for (const s of w.sessions)
				get(dayKey(s.start, zone)).recorded += s.seconds;
			if (w.accuracy === "accurate" && w.end) {
				const d = get(dayKey(w.end, zone));
				if (w.completed) d.watches.push(w);
				d.estimated += w.estimatedSeconds;
			}
		}
		return days;
	}, [filtered, zone]);
	const today = dayKey(new Date().toISOString(), zone);
	const monthDate = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
	monthDate.setUTCMonth(monthDate.getUTCMonth() + monthOffset);
	const month = monthDate.toISOString().slice(0, 7),
		week = dayOffset(Monday(today), weekOffset * 7),
		weekEnd = dayOffset(week, 6);
	const grouped = useMemo(
		() =>
			groupHistoryDays(filtered, zone).filter(
				([day]) =>
					!(from || to) ||
					(/^\d{4}/.test(day) && (!from || day >= from) && (!to || day <= to)),
			),
		[filtered, zone, from, to],
	);

	const streak = useMemo(() => {
		const dates = [...contributions]
			.filter(([, v]) => v.recorded + v.estimated > 0)
			.map(([d]) => d)
			.sort();
		let longest = 0,
			current = 0,
			last = "";
		for (const d of dates) {
			current = last && dayOffset(last, 1) === d ? current + 1 : 1;
			longest = Math.max(longest, current);
			last = d;
		}
		return longest;
	}, [contributions]);
	const catalog = data.titles.filter(
		(t) =>
			(kind === "all" || t.kind === kind) &&
			(statusFilter === "all" || t.status === statusFilter) &&
			t.name.toLowerCase().includes(search.toLowerCase()),
	);
	const heatStart = dayOffset(today, -364),
		heatDays = Array.from({ length: 365 }, (_, i) => dayOffset(heatStart, i));
	const heatMax = Math.max(
		3600,
		...[...contributions.values()].map((v) => v.recorded + v.estimated),
	);
	async function importFiles(files: FileList | null) {
		if (!files) return;
		setBusy(true);
		setError("");
		try {
			let count = 0;
			for (const file of [...files].sort(
				(a, b) =>
					Number(a.name.endsWith(".csv")) - Number(b.name.endsWith(".csv")),
			)) {
				const form = new FormData();
				form.set("file", file);
				const r = await fetch(endpoint, { method: "POST", body: form }),
					v = await r.json();
				if (!r.ok) throw new Error(v.error ?? "Import failed");
				count += v.imported;
			}
			await refresh();
			setMessage(
				`Imported ${count} title records. Reimporting updates existing records.`,
			);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Import failed");
		} finally {
			setBusy(false);
			if (upload.current) upload.current.value = "";
		}
	}
	function poster(w: Watch) {
		const session = w.sessions.find((s) => data.images[s.id]);
		const image = session ? data.images[session.id] : undefined;
		return image
			? getJellyfinImageUrl(serverUrl, image.itemId, image.tag, {
					width: 160,
					height: 240,
				})
			: data.settings.remotePosters
				? simklPoster(w.title.poster)
				: null;
	}
	function Recap({
		title,
		predicate,
		previous,
		next,
	}: {
		title: string;
		predicate: (day: string) => boolean;
		previous: () => void;
		next: () => void;
	}) {
		const days = [...contributions].filter(([day]) => predicate(day)),
			rec = days.reduce((s, [, d]) => s + d.recorded, 0),
			est = days.reduce((s, [, d]) => s + d.estimated, 0),
			count = days.reduce((s, [, d]) => s + d.watches.length, 0),
			active = days.filter(([, d]) => d.recorded + d.estimated > 0).length;
		const top = new Map<
			string,
			{ title: Title; seconds: number; count: number }
		>();
		for (const w of filtered) {
			let n = 0;
			for (const s of w.sessions)
				if (predicate(dayKey(s.start, zone))) n += s.seconds;
			if (w.accuracy === "accurate" && w.end && predicate(dayKey(w.end, zone)))
				n += w.estimatedSeconds;
			if (n) {
				const t = top.get(w.title.key) ?? {
					title: w.title,
					seconds: 0,
					count: 0,
				};
				t.seconds += n;
				if (w.completed && w.end && predicate(dayKey(w.end, zone))) t.count++;
				top.set(w.title.key, t);
			}
		}
		return (
			<section className="wl-recap">
				<div className="wl-section-heading">
					<h2>{title}</h2>
					<div className="wl-buttons">
						<button onClick={previous} aria-label="Previous period">
							←
						</button>
						<button onClick={next} aria-label="Next period">
							→
						</button>
					</div>
				</div>
				<div className="wl-recap-grid">
					<div>
						<span>RECORDED PLAYBACK</span>
						<strong>{seconds(rec)}</strong>
					</div>
					<div>
						<span>IMPORTED RUNTIME ESTIMATE</span>
						<strong>{seconds(est)}</strong>
					</div>
					<div>
						<span>COMPLETED WATCHES</span>
						<strong>{count}</strong>
					</div>
					<div>
						<span>ACTIVE DAYS</span>
						<strong>{active}</strong>
					</div>
				</div>
				<div className="wl-top">
					{[...top.values()]
						.sort((a, b) => b.seconds - a.seconds)
						.slice(0, 3)
						.map((t, i) => (
							<div key={t.title.key}>
								<b>{i + 1}</b>
								<div>
									<strong>{t.title.name}</strong>
									<small>
										{seconds(t.seconds)} · {t.count} completed watches
									</small>
								</div>
							</div>
						))}
					{!top.size && <p>No dated viewing in this period.</p>}
				</div>
			</section>
		);
	}
	async function submitManual(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const f = new FormData(event.currentTarget),
			name = String(f.get("name") ?? "").trim(),
			k = String(f.get("kind")),
			candidates = data.titles.filter(
				(t) =>
					normalize(t.name) === normalize(name) &&
					t.kind === k &&
					(!f.get("year") || t.year === Number(f.get("year"))),
			);
		const existing = candidates.length === 1 ? candidates[0] : undefined;
		const when = String(f.get("date") ?? ""),
			accuracy = String(f.get("accuracy"));
		const title = existing ?? {
			key: `manual:${k}:${normalize(name)}:${f.get("year") || "unknown"}`,
			name,
			kind: k,
			year: f.get("year") ? Number(f.get("year")) : undefined,
		};
		const ok = await mutate({
			action: "manual",
			entry: {
				title,
				season: k !== "movie" ? Number(f.get("season")) : undefined,
				episode: k !== "movie" ? Number(f.get("episode")) : undefined,
				episodeTitle: String(f.get("episodeTitle") ?? ""),
				watchedAt: when ? fromZonedTime(when, zone).toISOString() : null,
				accuracy: when ? accuracy : "unknown",
				runtime: Number(f.get("minutes")) * 60,
				completed: true,
			},
		});
		if (ok) setManual(false);
	}
	return (
		<main className="wl" aria-busy={switching}>
			<fieldset disabled={switching} className="wl-user-content">
			<header className="wl-header">
				<div>
					<span className="wl-eyebrow">YOUR WATCH LEDGER</span>
					<h1>
						Every watch.
						<br />
						<em>All in one place.</em>
					</h1>
					<p>{selectedName}’s viewing history, with resumes kept together.</p>
				</div>
				<div className="wl-buttons">
					<label className="wl-user-filter">
						<span>User</span>
						<select aria-label="Filter by user" value={selectedUserId} onChange={(event) => {
							const query = new URLSearchParams(searchParams.toString());
							query.set("userId", event.target.value);
							setSwitching(true);
							router.push(`${pathname}?${query.toString()}`);
						}}>
							{availableUsers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
						</select>
					</label>
					<Link href={`/servers/${serverId}/history`}>Raw sessions</Link>
					<button onClick={() => upload.current?.click()} disabled={busy}>
						<Import size={16} /> Import SIMKL
					</button>
					<button className="wl-primary" onClick={() => setManual(true)}>
						<Plus size={16} /> Log a watch
					</button>
					<button
						onClick={() => setSettings(true)}
						aria-label="History settings"
					>
						<Settings2 size={17} />
					</button>
				</div>
				<input
					hidden
					ref={upload}
					type="file"
					accept=".json,.csv"
					multiple
					onChange={(e) => void importFiles(e.target.files)}
				/>
			</header>
			{error && (
				<div className="wl-error" role="alert">
					{error}
				</div>
			)}
			{message && (
				<div className="wl-message" role="status">
					{message}
					<button onClick={() => setMessage("")} aria-label="Dismiss">
						<X size={14} />
					</button>
				</div>
			)}
			<div className="wl-stats">
				<div>
					<span>RECORDED PLAYBACK</span>
					<strong>{seconds(recorded)}</strong>
					<small>Actual session time</small>
				</div>
				<div>
					<span>COMPLETED WATCHES</span>
					<strong>{completed.length.toLocaleString("en-US")}</strong>
					<small>
						{new Set(completed.map((w) => w.title.key)).size} titles ·{" "}
						{data.sessionCount} raw sessions
					</small>
				</div>
				<div>
					<span>COMPLETED REWATCHES</span>
					<strong>{rewatches.length}</strong>
					<small>Repeated watches, not resumes</small>
				</div>
				<div>
					<span>HISTORICAL RUNTIME</span>
					<strong>{seconds(estimated)}</strong>
					<small>Estimated from imported runtimes</small>
				</div>
			</div>
			<nav className="wl-nav">
				<button
					className={tab === "history" ? "active" : ""}
					onClick={() => setTab("history")}
				>
					<Clock size={16} /> History
				</button>
				<button
					className={tab === "lists" ? "active" : ""}
					onClick={() => setTab("lists")}
				>
					<Film size={16} /> My lists
				</button>
				<div className="wl-kind">
					{[
						["all", "All"],
						["tv", "TV shows"],
						["movie", "Movies"],
						["anime", "Anime"],
					].map(([key, name]) => (
						<button
							key={key}
							className={kind === key ? "active" : ""}
							onClick={() => setKind(key)}
						>
							{name}
						</button>
					))}
				</div>
			</nav>
			<div className="wl-filter">
				<Search size={17} />
				<input
					aria-label="Search history"
					placeholder="Search your shows, movies, or episodes…"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				{tab === "history" ? (
					<>
						<label>
							From{" "}
							<input
								type="date"
								value={from}
								onChange={(e) => setFrom(e.target.value)}
							/>
						</label>
						<label>
							To{" "}
							<input
								type="date"
								value={to}
								onChange={(e) => setTo(e.target.value)}
							/>
						</label>
					</>
				) : (
					<select
						aria-label="List status"
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
					>
						{[
							"all",
							"planned",
							"watching",
							"completed",
							"on-hold",
							"dropped",
						].map((v) => (
							<option key={v}>{v}</option>
						))}
					</select>
				)}
			</div>
			{tab === "history" ? (
				<>
					<section className="wl-calendar">
						<div className="wl-section-heading">
							<h2>
								A year, <em>day by day.</em>
							</h2>
							<span>
								{streak} day longest streak · {zone}
							</span>
						</div>
						<div className="wl-heatmap">
							{heatDays.map((day) => {
								const d = contributions.get(day),
									n = (d?.recorded ?? 0) + (d?.estimated ?? 0),
									level = n
										? Math.min(4, Math.max(1, Math.ceil((n / heatMax) * 4)))
										: 0;
								return (
									<button
										key={day}
										className={`level-${level}`}
										aria-label={`${day}: ${seconds(n)}`}
										title={`${dateLabel(day)}: ${seconds(d?.recorded ?? 0)} recorded + ${seconds(d?.estimated ?? 0)} imported estimate`}
										onClick={() => {
											setFrom(day);
											setTo(day);
										}}
									/>
								);
							})}
						</div>
						<div className="wl-calendar-foot">
							<span>
								Click a day to filter history. Approximate dates are excluded.
							</span>
							<button
								onClick={() => {
									setFrom("");
									setTo("");
								}}
							>
								Clear date filter
							</button>
						</div>
					</section>
					{!from && !to && (
						<>
							<Recap
								title={`Your month, recapped · ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(monthDate)}`}
								predicate={(day) => day.startsWith(month)}
								previous={() => setMonthOffset((n) => n - 1)}
								next={() => setMonthOffset((n) => n + 1)}
							/>
							<Recap
								title={`Your week, recapped · ${week} – ${weekEnd}`}
								predicate={(day) => day >= week && day <= weekEnd}
								previous={() => setWeekOffset((n) => n - 1)}
								next={() => setWeekOffset((n) => n + 1)}
							/>
						</>
					)}
					<section className="wl-timeline">
						{grouped.map(([day, watches]) => (
							<section key={day} className="wl-day">
								<div className="wl-day-heading">
									<CalendarDays size={18} />
									<h2>{/^\d/.test(day) ? dateLabel(day) : day}</h2>
									<span>
										{watches.length} watch{watches.length === 1 ? "" : "es"}
									</span>
								</div>
								<div className="wl-watch-grid">
									{watches.map((w) => {
										const url = poster(w);
										return (
											<article className="wl-watch" key={w.id}>
												{url ? (
													<img
														src={url}
														alt=""
														loading="lazy"
														referrerPolicy="no-referrer"
														onError={(e) => {
															const fallback = data.settings.remotePosters
																? simklPoster(w.title.poster)
																: null;
															if (fallback && e.currentTarget.src !== fallback)
																e.currentTarget.src = fallback;
															else e.currentTarget.style.display = "none";
														}}
													/>
												) : (
													<div className="wl-poster">
														{w.title.kind === "movie" ? <Film /> : <Tv />}
													</div>
												)}
												<div className="wl-watch-info">
													<div className="wl-watch-title">
														<h3>{w.title.name}</h3>
														<button
															aria-label={`Edit ${w.title.name} watch`}
															onClick={() =>
																setEdit(
																	data.watches.find(
																		(original) => original.id === w.id,
																	) ?? w,
																)
															}
														>
															<ChevronDown size={16} />
														</button>
													</div>
													<p>{label(w)}</p>
													<div className="wl-badges">
														{w.rewatch && (
															<span className="wl-repeat">
																<Repeat size={11} />{" "}
																{w.completed
																	? "Rewatch"
																	: "Rewatch in progress"}
															</span>
														)}
														<span>
															{w.completed ? "Completed" : "In progress"}
														</span>
														{w.accuracy !== "accurate" && (
															<span>
																{w.accuracy === "estimated"
																	? "Estimated date"
																	: "Date unknown"}
															</span>
														)}
														{w.completionBasis === "reported" && (
															<span>Legacy completion</span>
														)}
													</div>
													<small>
														{w.end && w.accuracy === "accurate"
															? formatInTimeZone(w.end, zone, "h:mm a") + " · "
															: ""}
														{w.measuredSeconds
															? seconds(w.measuredSeconds) + " recorded"
															: seconds(w.estimatedSeconds) +
																" estimated runtime"}
														{w.sessions.length
															? ` · ${w.sessions.length} session${w.sessions.length === 1 ? "" : "s"}`
															: ""}
													</small>
													{w.coverage !== null && (
														<div
															className="wl-progress"
															aria-label={`${Math.round(w.coverage * 100)}% viewed`}
														>
															<i
																style={{
																	width: `${Math.round(w.coverage * 100)}%`,
																}}
															/>
														</div>
													)}
												</div>
											</article>
										);
									})}
								</div>
							</section>
						))}
						{!grouped.length && (
							<div className="wl-empty">
								<Clock size={36} />
								<h2>Your history starts here.</h2>
								<p>
									Import your SIMKL JSON and CSV, log a watch, or play something
									in Jellyfin.
								</p>
								<button onClick={() => upload.current?.click()}>
									Import history
								</button>
							</div>
						)}
					</section>
				</>
			) : (
				<section className="wl-lists">
					{catalog.map((t) => (
						<article key={t.key}>
							<h3>{t.name}</h3>
							<p>
								{t.kind.toUpperCase()} {t.year ?? ""}{" "}
								{t.latestEpisode ? ` · ${t.latestEpisode}` : ""}
							</p>
							<label>
								Status{" "}
								<select
									value={t.status ?? "planned"}
									disabled={busy}
									onChange={(e) =>
										void mutate({
											action: "title",
											title: { ...t, status: e.target.value },
										})
									}
								>
									{[
										"planned",
										"watching",
										"completed",
										"on-hold",
										"dropped",
									].map((v) => (
										<option key={v}>{v}</option>
									))}
								</select>
							</label>
							<label>
								Rating{" "}
								<input
									type="number"
									min="0"
									max="10"
									step=".5"
									defaultValue={t.rating ?? ""}
									aria-label={`Rating for ${t.name}`}
									onBlur={(e) => {
										if (
											e.target.value !== "" &&
											Number(e.target.value) !== t.rating
										)
											void mutate({
												action: "title",
												title: { ...t, rating: Number(e.target.value) },
											});
									}}
								/>
							</label>
						</article>
					))}
					{!catalog.length && (
						<p>No titles match. Import SIMKL to populate your lists.</p>
					)}
				</section>
			)}
			<footer className="wl-footer">
				<p>
					Recorded time and imported runtime estimates stay separate. Sessions
					spanning midnight are assigned to their start date. Deleted Jellyfin
					metadata can prevent automatic episode matching.
				</p>
				{data.hiddenCount > 0 && (
					<button
						disabled={busy}
						onClick={() => void mutate({ action: "restore" })}
					>
						<Undo2 size={14} /> Reset all watch corrections ({data.hiddenCount}{" "}
						hidden)
					</button>
				)}
			</footer>
			{manual && (
				<Modal label="Log a watch" onClose={() => setManual(false)}>
					<section
						className="wl-dialog"
						role="dialog"
						aria-modal="true"
						aria-labelledby="log-title"
					>
						<div className="wl-section-heading">
							<h2 id="log-title">Log a watch</h2>
							<button aria-label="Close" onClick={() => setManual(false)}>
								<X />
							</button>
						</div>
						<form onSubmit={(e) => void submitManual(e)}>
							<label>
								Title
								<input name="name" required maxLength={300} list="wl-titles" />
								<datalist id="wl-titles">
									{data.titles.map((t) => (
										<option key={t.key} value={t.name} />
									))}
								</datalist>
							</label>
							<div className="wl-form-row">
								<label>
									Type
									<select name="kind">
										<option value="tv">TV episode</option>
										<option value="movie">Movie</option>
										<option value="anime">Anime episode</option>
									</select>
								</label>
								<label>
									Year
									<input name="year" type="number" min={1800} max={2200} />
								</label>
							</div>
							<div className="wl-form-row">
								<label>
									Season (TV/anime)
									<input
										name="season"
										type="number"
										min={0}
										max={1000}
										defaultValue={1}
									/>
								</label>
								<label>
									Episode (TV/anime)
									<input
										name="episode"
										type="number"
										min={0}
										max={100000}
										defaultValue={1}
									/>
								</label>
							</div>
							<label>
								Episode title (optional)
								<input name="episodeTitle" maxLength={300} />
							</label>
							<label>
								Watched at ({zone}; leave blank if unknown)
								<input name="date" type="datetime-local" />
							</label>
							<div className="wl-form-row">
								<label>
									Date accuracy
									<select name="accuracy">
										<option value="accurate">Accurate</option>
										<option value="estimated">Estimated</option>
										<option value="unknown">Unknown</option>
									</select>
								</label>
								<label>
									Runtime, minutes
									<input
										name="minutes"
										type="number"
										required
										min={0}
										max={1440}
										defaultValue={45}
									/>
								</label>
							</div>
							<p>
								Manual logs use runtime estimates. They do not pretend to be
								measured playback.
							</p>
							<button className="wl-primary" disabled={busy}>
								Save watch
							</button>
						</form>
					</section>
				</Modal>
			)}
			{edit && (
				<Modal label="Edit watch" onClose={() => setEdit(null)}>
					<section
						className="wl-dialog"
						role="dialog"
						aria-modal="true"
						aria-labelledby="edit-title"
					>
						<div className="wl-section-heading">
							<h2 id="edit-title">{edit.title.name}</h2>
							<button aria-label="Close" onClick={() => setEdit(null)}>
								<X />
							</button>
						</div>
						<p>{label(edit)}</p>
						<label>
							<input
								type="checkbox"
								checked={edit.completed}
								onChange={(e) =>
									setEdit({ ...edit, completed: e.target.checked })
								}
							/>{" "}
							Completed watch
						</label>
						<label>
							<input
								type="checkbox"
								checked={edit.rewatch}
								onChange={(e) =>
									setEdit({ ...edit, rewatch: e.target.checked })
								}
							/>{" "}
							This is a rewatch
						</label>
						<form
							onSubmit={async (e) => {
								e.preventDefault();
								const v = new FormData(e.currentTarget).get("date");
								const patch = {
									completed: edit.completed,
									rewatch: edit.rewatch,
									...(v
										? {
												watchedAt: fromZonedTime(String(v), zone).toISOString(),
											}
										: {}),
								};
								if (await mutate({ action: "correct", key: edit.id, patch }))
									setEdit(null);
							}}
						>
							<label>
								Correct watched date ({zone})
								<input name="date" type="datetime-local" defaultValue="" />
							</label>
							<button className="wl-primary" disabled={busy}>
								Save corrections
							</button>
						</form>
						<details>
							<summary>
								{edit.sessions.length} original playback sessions
							</summary>
							{edit.sessions.map((s) => (
								<p key={s.id}>
									{formatInTimeZone(s.start, zone, "MMM d, h:mm a")} ·{" "}
									{seconds(s.seconds)} · {s.device}
								</p>
							))}
						</details>
						<button
							disabled={busy}
							onClick={async () => {
								if (await mutate({ action: "resetCorrection", key: edit.id }))
									setEdit(null);
							}}
						>
							Reset this watch’s corrections
						</button>
						<button
							className="wl-danger"
							disabled={busy}
							onClick={async () => {
								if (
									await mutate({
										action: "correct",
										key: edit.id,
										patch: { hidden: true },
									})
								)
									setEdit(null);
							}}
						>
							Remove watch from ledger
						</button>
						<p>
							Removal is reversible. Original sessions remain in the raw
							history.
						</p>
					</section>
				</Modal>
			)}
			{settings && (
				<Modal label="History settings" onClose={() => setSettings(false)}>
					<section
						className="wl-dialog"
						role="dialog"
						aria-modal="true"
						aria-labelledby="settings-title"
					>
						<div className="wl-section-heading">
							<h2 id="settings-title">History settings</h2>
							<button aria-label="Close" onClick={() => setSettings(false)}>
								<X />
							</button>
						</div>
						<form
							onSubmit={async (e) => {
								e.preventDefault();
								const f = new FormData(e.currentTarget);
								if (
									await mutate({
										action: "settings",
										settings: {
											completionThreshold: Number(f.get("threshold")) / 100,
											setupDay: String(f.get("setupDay")),
											timezone: String(f.get("timezone")),
											remotePosters: f.get("remotePosters") === "on",
											confirmedPriorTitles: String(f.get("priorTitles") ?? "")
												.split(",")
												.map(normalize)
												.filter(Boolean),
										},
									})
								)
									setSettings(false);
							}}
						>
							<label>
								Completion threshold, percent
								<input
									name="threshold"
									type="number"
									min={50}
									max={100}
									defaultValue={data.settings.completionThreshold * 100}
								/>
							</label>
							<label>
								SIMKL bulk setup day (UTC date)
								<input
									name="setupDay"
									type="date"
									required
									defaultValue={data.settings.setupDay}
								/>
							</label>
							<label>
								Timezone
								<input name="timezone" required defaultValue={zone} />
							</label>
							<label>
								<input
									type="checkbox"
									name="remotePosters"
									defaultChecked={data.settings.remotePosters}
								/>{" "}
								Load missing posters from SIMKL’s image server
							</label>
							<label>
								Confirmed prior viewings (comma-separated titles)
								<input
									name="priorTitles"
									defaultValue={data.settings.confirmedPriorTitles.join(", ")}
								/>
							</label>
							<p>
								These titles can be recognized as rewatches even when their
								first-watch dates were estimated.
							</p>
							<p>
								SIMKL entries on setup day are undated history. Earlier dates
								are approximate and excluded from activity. Dates after setup
								day are accurate.
							</p>
							<button disabled={busy} className="wl-primary">
								Save settings
							</button>
						</form>
					</section>
				</Modal>
			)}
		</fieldset>
		</main>
	);
}

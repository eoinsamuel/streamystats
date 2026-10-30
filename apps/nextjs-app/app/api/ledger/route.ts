import { randomUUID } from "node:crypto";
import { db, ledgerRecords } from "@streamystats/database";
import { and, eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-auth";
import { defaults, record } from "@/lib/ledger/engine";
import {
	parseSimklCsv,
	parseSimklJson,
	type ImportedRecord,
} from "@/lib/ledger/import";
import { resolveLedgerUser } from "@/lib/ledger/access";
import { getWatchLedger } from "@/lib/ledger/store";
const serverSchema = z.coerce.number().int().positive();
const titleSchema = z.object({
	key: z.string().min(1).max(300),
	name: z.string().min(1).max(300),
	kind: z.enum(["tv", "movie", "anime"]),
	year: z.number().int().min(1800).max(2200).optional(),
	status: z
		.enum(["planned", "watching", "completed", "on-hold", "dropped"])
		.optional(),
	rating: z.number().min(0).max(10).optional(),
});
const correctionSchema = z.object({
	hidden: z.boolean().optional(),
	completed: z.boolean().optional(),
	rewatch: z.boolean().optional(),
	watchedAt: z.string().datetime({ offset: true }).optional(),
});
const manualSchema = z
	.object({
		title: titleSchema,
		season: z.number().int().min(0).max(1000).optional(),
		episode: z.number().int().min(0).max(100000).optional(),
		episodeTitle: z.string().max(300).optional(),
		watchedAt: z.string().datetime({ offset: true }).nullable(),
		accuracy: z.enum(["accurate", "estimated", "unknown"]),
		runtime: z.number().min(0).max(86400),
		completed: z.boolean(),
	})
	.refine(
		(v) =>
			v.title.kind === "movie" ||
			(v.season !== undefined && v.episode !== undefined),
		"Enter season and episode numbers.",
	);
async function save({
	serverId,
	userId,
	rows,
}: {
	serverId: number;
	userId: string;
	rows: ImportedRecord[];
}) {
	await db.transaction(async (tx) => {
		for (const row of rows)
			await tx
				.insert(ledgerRecords)
				.values({ id: randomUUID(), serverId, userId, ...row })
				.onConflictDoUpdate({
					target: [
						ledgerRecords.serverId,
						ledgerRecords.userId,
						ledgerRecords.kind,
						ledgerRecords.sourceKey,
					],
					set: { payload: row.payload, updatedAt: new Date() },
				});
	});
	revalidateTag(`ledger-${serverId}-${userId}`, "max");
	revalidateTag(
		`wrapped-rewatch-${serverId}-${userId}-${new Date().getUTCFullYear()}`,
		"max",
	);
}
export async function GET(request: NextRequest) {
	const sid = serverSchema.safeParse(
		request.nextUrl.searchParams.get("serverId"),
	);
	if (!sid.success)
		return NextResponse.json({ error: "Invalid server" }, { status: 400 });
	const auth = await requireSession(sid.data);
	if (auth.error) return auth.error;
	const userId = await resolveLedgerUser(auth.session, request.nextUrl.searchParams.get("userId"));
	if (!userId) return NextResponse.json({ error: "User is not available" }, { status: 403 });
	return NextResponse.json(
		await getWatchLedger({ serverId: sid.data, userId }),
	);
}
function sameOrigin(request: NextRequest): boolean {
	const value = request.headers.get("origin");
	if (!value) return false;
	try {
		const origin = new URL(value);
		const host =
			request.headers.get("x-forwarded-host") ??
			request.headers.get("host") ??
			request.nextUrl.host;
		return (
			["http:", "https:"].includes(origin.protocol) && origin.host === host
		);
	} catch {
		return false;
	}
}
export async function POST(request: NextRequest) {
	const sid = serverSchema.safeParse(
		request.nextUrl.searchParams.get("serverId"),
	);
	if (!sid.success)
		return NextResponse.json({ error: "Invalid server" }, { status: 400 });
	const auth = await requireSession(sid.data);
	if (auth.error) return auth.error;
	const userId = await resolveLedgerUser(auth.session, request.nextUrl.searchParams.get("userId"));
	if (!userId) return NextResponse.json({ error: "User is not available" }, { status: 403 });
	// Mutations require a same-origin browser request; existing session cookies
	// remain the only authentication source and tokens are never sent to SIMKL.
	if (!sameOrigin(request))
		return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
	try {
		let rows: ImportedRecord[] = [];
		if (request.headers.get("content-type")?.includes("multipart/form-data")) {
			const form = await request.formData(),
				file = form.get("file");
			if (!(file instanceof File) || file.size > 20 * 1024 * 1024)
				throw new Error("Choose a SIMKL JSON/CSV file under 20 MB.");
			const text = await file.text(),
				ledger = await getWatchLedger({
					serverId: sid.data,
					userId,
				});
			rows = file.name.toLowerCase().endsWith(".csv")
				? parseSimklCsv(text)
				: parseSimklJson(JSON.parse(text), ledger.settings);
		} else {
			const body = record(await request.json());
			if (!body) throw new Error("Invalid request");
			if (body.action === "manual") {
				const v = manualSchema.parse(body.entry),
					key = randomUUID();
				rows = [
					{
						kind: "manual",
						sourceKey: key,
						payload: { ...v, key, source: "manual" },
					},
				];
			} else if (body.action === "correct") {
				const key = z.string().min(1).max(1000).parse(body.key),
					patch = correctionSchema.parse(body.patch);
				const existing = await db.query.ledgerRecords.findFirst({
					where: and(
						eq(ledgerRecords.serverId, sid.data),
						eq(ledgerRecords.userId, userId),
						eq(ledgerRecords.kind, "correction"),
						eq(ledgerRecords.sourceKey, key),
					),
				});
				rows = [
					{
						kind: "correction",
						sourceKey: key,
						payload: { ...existing?.payload, ...patch },
					},
				];
			} else if (
				body.action === "restore" ||
				body.action === "resetCorrection"
			) {
				const key =
					body.action === "resetCorrection"
						? z.string().min(1).max(1000).parse(body.key)
						: undefined;
				await db
					.delete(ledgerRecords)
					.where(
						and(
							eq(ledgerRecords.serverId, sid.data),
							eq(ledgerRecords.userId, userId),
							eq(ledgerRecords.kind, "correction"),
							key ? eq(ledgerRecords.sourceKey, key) : undefined,
						),
					);
				revalidateTag(`ledger-${sid.data}-${userId}`, "max");
			} else if (body.action === "title") {
				const title = titleSchema.parse(body.title);
				rows = [{ kind: "title", sourceKey: title.key, payload: { title } }];
			} else if (body.action === "settings") {
				const v = z
					.object({
						completionThreshold: z.number().min(0.5).max(1),
						setupDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
						timezone: z.string().max(100),
						remotePosters: z.boolean(),
						confirmedPriorTitles: z.array(z.string().max(300)).max(1000),
					})
					.parse(body.settings);
				new Intl.DateTimeFormat("en", { timeZone: v.timezone });
				rows = [
					{
						kind: "settings",
						sourceKey: "settings",
						payload: { ...defaults, ...v },
					},
				];
			} else throw new Error("Unknown action");
		}
		if (rows.length > 10000) throw new Error("Import exceeds 10,000 titles.");
		if (rows.length)
			await save({ serverId: sid.data, userId, rows });
		return NextResponse.json({ ok: true, imported: rows.length });
	} catch (error) {
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : "Unable to save history",
			},
			{ status: 400 },
		);
	}
}

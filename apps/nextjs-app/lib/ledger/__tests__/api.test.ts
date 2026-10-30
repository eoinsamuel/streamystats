import { afterEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { ledgerRecords, users } from "@streamystats/database";
let authorized = true;
let admin = false;
let seen: unknown = null;
const writes: unknown[] = [];
mock.module("server-only", () => ({}));
mock.module("@/lib/api-auth", () => ({
	requireSession: async (serverId: number) =>
		authorized && serverId === 1
			? { error: null, session: { id: "eoin", name: "Eoin", serverId: 1, isAdmin: admin } }
			: { error: new Response("Unauthorized", { status: 401 }), session: null },
}));
mock.module("@/lib/ledger/store", () => ({
	getWatchLedger: async (args: unknown) => {
		seen = args;
		return {
			settings: {
				completionThreshold: 0.9,
				setupDay: "2026-04-25",
				timezone: "America/New_York",
				confirmedPriorTitles: ["smallville"],
			},
			watches: [],
		};
	},
}));
mock.module("next/cache", () => ({ revalidateTag: () => {} }));
mock.module("@streamystats/database", () => ({
	ledgerRecords,
	users,
	db: {
        select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [{ id: "eoin", name: "Eoin" }, { id: "celeste", name: "Celeste" }] }) }) }),
		transaction: async (fn: (tx: unknown) => Promise<void>) =>
			fn({
				insert: () => ({
					values: (value: unknown) => ({
						onConflictDoUpdate: async () => {
							writes.push(value);
						},
					}),
				}),
			}),
		query: { ledgerRecords: { findFirst: async () => null } },
	},
}));
const { GET, POST } = await import("@/app/api/ledger/route");
afterEach(() => {
	authorized = true;
	admin = false;
	seen = null;
	writes.length = 0;
});
test("GET requires a session and enforces the server boundary", async () => {
	authorized = false;
	expect(
		(await GET(new NextRequest("http://localhost/api/ledger?serverId=1")))
			.status,
	).toBe(401);
	authorized = true;
	expect(
		(await GET(new NextRequest("http://localhost/api/ledger?serverId=2")))
			.status,
	).toBe(401);
	expect(seen).toBeNull();
});
test("non-admin cannot read another user", async () => {
	expect(
		(
			await GET(
				new NextRequest("http://localhost/api/ledger?serverId=1&userId=other"),
			)
		).status,
	).toBe(403);
	expect(seen).toBeNull();
});
test("cross-origin writes are rejected", async () => {
	const r = await POST(
		new NextRequest("http://localhost/api/ledger?serverId=1", {
			method: "POST",
			headers: {
				origin: "https://other.example",
				"content-type": "application/json",
			},
			body: '{"action":"manual"}',
		}),
	);
	expect(r.status).toBe(403);
	expect(writes).toHaveLength(0);
});
test("manual movie logs are validated and scoped to the signed-in user", async () => {
	const entry = {
		title: { key: "movie:test", name: "Test", kind: "movie" },
		watchedAt: "2026-10-29T18:00:00Z",
		accuracy: "accurate",
		runtime: 7200,
		completed: true,
	};
	const r = await POST(
		new NextRequest("http://localhost/api/ledger?serverId=1", {
			method: "POST",
			headers: {
				origin: "http://localhost",
				"content-type": "application/json",
			},
			body: JSON.stringify({ action: "manual", userId: "other", entry }),
		}),
	);
	expect(r.status).toBe(200);
	expect(writes[0]).toMatchObject({
		serverId: 1,
		userId: "eoin",
		kind: "manual",
		payload: { runtime: 7200, source: "manual" },
	});
});
test("episode logs require episode identity", async () => {
	const entry = {
		title: { key: "show:test", name: "Test", kind: "tv" },
		watchedAt: null,
		accuracy: "unknown",
		runtime: 2400,
		completed: true,
	};
	const r = await POST(
		new NextRequest("http://localhost/api/ledger?serverId=1", {
			method: "POST",
			headers: {
				origin: "http://localhost",
				"content-type": "application/json",
			},
			body: JSON.stringify({ action: "manual", entry }),
		}),
	);
	expect(r.status).toBe(400);
	expect(writes).toHaveLength(0);
});

test("admin can read a selected user on the server", async () => {
  admin = true;
  const response = await GET(new NextRequest("http://localhost/api/ledger?serverId=1&userId=celeste"));
  expect(response.status).toBe(200);
  expect(seen).toEqual({ serverId: 1, userId: "celeste" });
});
test("admin cannot select an unknown or different-server user", async () => {
  admin = true;
  expect((await GET(new NextRequest("http://localhost/api/ledger?serverId=1&userId=outside"))).status).toBe(403);
  expect(seen).toBeNull();
});
test("non-admin cannot write to another user", async () => {
  const response = await POST(new NextRequest("http://localhost/api/ledger?serverId=1&userId=celeste", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "title", title: { key: "movie:test", name: "Test", kind: "movie" } }),
  }));
  expect(response.status).toBe(403);
  expect(writes).toHaveLength(0);
});
test("admin writes are scoped to the selected user", async () => {
  admin = true;
  const response = await POST(new NextRequest("http://localhost/api/ledger?serverId=1&userId=celeste", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "title", title: { key: "movie:test", name: "Test", kind: "movie" } }),
  }));
  expect(response.status).toBe(200);
  expect(writes[0]).toMatchObject({ serverId: 1, userId: "celeste", kind: "title" });
});

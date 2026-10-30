import "server-only";
import { validateAdminWithJellyfin } from "@/lib/db/users";
import { db, users } from "@streamystats/database";
import { eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/session";

export async function ledgerUsers(session: SessionUser) {
  if (!session.isAdmin || !(await validateAdminWithJellyfin()))
    return [{ id: session.id, name: session.name }];
  const result = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.serverId, session.serverId))
    .orderBy(users.name);
  if (!result.some((user) => user.id === session.id))
    result.unshift({ id: session.id, name: session.name });
  return result;
}

export async function resolveLedgerUser(session: SessionUser, requested: string | null) {
  if (!requested || requested === session.id) return session.id;
  if (!session.isAdmin) return null;
  const allowed = await ledgerUsers(session);
  return allowed.some((user) => user.id === requested) ? requested : null;
}

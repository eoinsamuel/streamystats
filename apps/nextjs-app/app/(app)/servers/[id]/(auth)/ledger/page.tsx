import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/api-auth";
import { getServer } from "@/lib/db/server";
import { ledgerUsers, resolveLedgerUser } from "@/lib/ledger/access";
import { LedgerLimitError } from "@/lib/ledger/limits";
import { getLedgerView } from "@/lib/ledger/view";
import { Ledger } from "./Ledger";
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ userId?: string | string[] }>;
};
async function Content({ params, searchParams }: Props) {
  const { id } = await params;
  const auth = await requireSession(id);
  if (auth.error) redirect(`/servers/${id}/login`);
  const server = await getServer({ serverId: id });
  if (!server) redirect("/setup");
  const query = await searchParams;
  const requested = typeof query.userId === "string" ? query.userId : null;
  const userId = await resolveLedgerUser(auth.session, requested);
  if (!userId) redirect(`/servers/${id}/ledger`);
  const availableUsers = await ledgerUsers(auth.session);
  try {
    const initial = await getLedgerView({
      serverId: server.id,
      userId,
    });
    return (
      <Ledger
        key={userId}
        initial={initial}
        serverId={server.id}
        serverUrl={server.url}
        selectedUserId={userId}
        availableUsers={availableUsers}
      />
    );
  } catch (error) {
    if (error instanceof LedgerLimitError)
      return (
        <p role="alert" className="p-8">
          {error.message}
        </p>
      );
    throw error;
  }
}
export default function Page(props: Props) {
  return (
    <Suspense fallback={<p className="p-8 text-muted-foreground">Loading your watch ledger…</p>}>
      <Content {...props} />
    </Suspense>
  );
}

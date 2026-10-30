import { getWatchLedger } from "./store";
import { buildLedgerView } from "./view-model";

export async function getLedgerView({
  serverId,
  userId,
  query = new URLSearchParams(),
}: {
  serverId: number;
  userId: string;
  query?: URLSearchParams;
}) {
  return buildLedgerView(await getWatchLedger({ serverId, userId }), query);
}

import { requireSession } from "@/lib/api-auth";
import { getIncludeImportedPreference } from "@/lib/ledger/imported-statistics";
import { ImportedStatsToggle } from "./ImportedStatsToggle";
export async function ImportedStatsControl({ serverId }: { serverId: number }) {
  const auth = await requireSession(serverId);
  if (auth.error) return null;
  return (
    <ImportedStatsToggle
      serverId={serverId}
      initial={await getIncludeImportedPreference({ serverId, userId: auth.session.id })}
    />
  );
}

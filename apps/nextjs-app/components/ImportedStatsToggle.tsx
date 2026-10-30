"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/utils";
export function ImportedStatsToggle({ serverId, initial }: { serverId: number; initial: boolean }) {
  const [enabled, setEnabled] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => setEnabled(initial), [initial]);
  return (
    <div className="my-4 rounded-lg border p-3 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={async (event) => {
            const next = event.currentTarget.checked;
            setBusy(true);
            setError("");
            try {
              const response = await fetch(`${basePath}/api/ledger?serverId=${serverId}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  action: "settings",
                  settings: { includeImportedStats: next },
                }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error ?? "Unable to save preference");
              setEnabled(next);
              router.refresh();
            } catch (error) {
              setError(error instanceof Error ? error.message : "Unable to save preference");
            } finally {
              setBusy(false);
            }
          }}
        />
        Include my imported/estimated watches in statistics
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Shared with Watch Ledger. Confirmed manual logs are included. This switch adds
        imported/estimated history; playback measurements stay distinct.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

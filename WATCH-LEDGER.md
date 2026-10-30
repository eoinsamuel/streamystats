# Watch Ledger for Streamystats, first version

This is a custom build of Streamystats based on upstream commit `1a154af6e59b5f6a5407f1e18704cc6bd5ac15bf`. The existing dashboard stays in place. **Watch Ledger** adds a SIMKL-style history with daily cards, an activity calendar, monthly and weekly recaps, list statuses, ratings, manual logs, and reversible corrections. **Raw Sessions** keeps the original session table available.

## Install on your Ubuntu server

Extract the project folder onto your server. Keep the extracted folder after installation: it contains the Compose override used by your upgraded app containers.

From that folder:

```bash
bash install-ledger.sh --check
bash install-ledger.sh
```

The installer is configured for your `streamystat-nextjs-app-1`, `streamystat-job-server-1`, and `streamystat-vectorchord-1` containers. It discovers the original Compose files from Docker labels. It builds two local images, briefly stops the Streamystats apps, backs up the full database, validates that backup, and recreates only the two app services. The job server runs the additive migration for `ledger_records` automatically. The database image and volume, Jellyfin, and other services are not replaced. Builds may take several minutes. The installer restores the previous app images if installation fails.

You need Docker Compose V2 with `--wait` support. Runtime connection settings and secrets remain in your original Compose environment. Nothing in this package connects to your running server until you run the installer.

To return to the original app images:

```bash
bash install-ledger.sh --rollback
```

The additional ledger table is retained for a later reinstall. Keep the printed database backup too. Do not use `docker compose down -v`.

## First run

1. Open your usual Streamystats address and sign in as your own Jellyfin user.
2. Choose **Watch Ledger** in the sidebar.
3. Click **Import SIMKL** and select your older `SimklBackup.json` and newer `SimklBackup.csv`. You can select both together; JSON is processed before CSV. Importing the same title from the same format updates its existing record rather than appending duplicates.
4. The JSON supplies per-episode history. The CSV supplies the newer list status, last episode summary and ratings; it does not invent episode history that is absent from the JSON.
5. In history settings, confirm the timezone, the SIMKL setup day, and the titles with confirmed prior viewings.

Defaults match the history you described: America/New_York, April 25, 2026 as the bulk setup day, and Smallville as a confirmed prior viewing. Setup-day records have unknown original watch dates. Earlier SIMKL dates are approximate; later dates are accurate. Approximate and unknown dates never contribute activity, recaps, or streaks. Their runtime totals are labeled estimates. These settings belong to the signed-in user.

## Counting watches

A playback session is not a watch. Legacy sessions for the same episode are grouped into one watch even when they span several days or devices. Existing inferred sessions are context, not measured time. Recognizable imported endpoint copies are excluded from the ledger's recorded time without deleting raw sessions.

For new playback, the job server records the portions of the media that advance during normal playback. Pauses, rewinds, network gaps and seek jumps do not create extra coverage. Overlapping portions are counted once. The completion threshold defaults to 90% and is adjustable. A restart near the beginning after a completed watch opens a tentative new watch; it contributes to completed rewatch counts only when it meets the completion threshold. This also updates Wrapped's rewatch section to use completed watches instead of session counts.

Past data cannot be reconstructed into precise watched ranges. Legacy completion flags/positions remain reported completion, labeled **Legacy completion**. Imported SIMKL completion can establish that something was watched. Undated/estimated imports enrich existing viewing rather than automatically manufacturing a second watch. A confirmed prior title such as Smallville can establish its earlier watch despite an estimated first-watch date. Unknown episode numbering on deleted Jellyfin metadata is preserved without guessing which SIMKL episode it belongs to.

## Editing

Use a watch card's menu to mark completion, correct whether it is a rewatch, change a watch date, or remove it from the ledger. Original sessions remain in Raw Sessions. Reset that watch's corrections to undo the change. The footer can reset all corrections if watches were hidden. Manual logs can include titles that are absent from Jellyfin. List/rating changes are local; nothing is written to SIMKL or Jellyfin.

## Current limitations

- No live SIMKL or Trakt API sync yet. Existing JSON/CSV imports work without paid API features.
- No external catalog search yet; manually enter a title or choose one of your imported titles.
- Daily recorded time is attributed to the session's start date. Sessions spanning midnight do not yet have exact per-day allocation.
- The SIMKL JSON uses show-level runtime estimates for imported episode history.
- Automatic restart detection applies to range-aware recordings made by this build. Legacy raw sessions are grouped conservatively and can be corrected manually.
- Deleting/hiding a ledger watch updates ledger/Wrapped watch counts; other upstream dashboard panels continue to show raw session-based analytics.
- The upstream JSON backup/export route does not include ledger additions. Use full PostgreSQL backups to preserve imported history, manual logs, settings and corrections. The installer takes one before upgrading.
- The live Docker images could not be built or launched in the preparation environment, which has no Docker daemon. The Next.js production compile, both TypeScript checks, import regression tests, watch-engine tests, migration execution under PostgreSQL WASM, and shell installer checks are recorded in VALIDATION.md. Browser visual QA uses a static rendering of the actual component, not a live Jellyfin connection.

## Source and data

Your personal backups and API keys are not included in the source package. Imported records stay in PostgreSQL, scoped to your server and Jellyfin user. Viewing data is not sent to SIMKL. The browser can load missing posters from SIMKL’s public image server without a token; disable remote posters in history settings for offline-only images. Native session synchronization continues to use Streamystats' existing Jellyfin integration.

Upstream: https://github.com/fredrikburmester/streamystats . The upstream package metadata declares MIT licensing; retain upstream attribution when distributing changes.

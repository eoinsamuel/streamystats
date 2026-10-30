# Watch Ledger validation

The package was prepared from Streamystats upstream commit `1a154af6e59b5f6a5407f1e18704cc6bd5ac15bf`.

Passed:

- Shared database package TypeScript build.
- Next.js app and job-server TypeScript checks.
- Next.js production compile with both `/servers/[id]/ledger` and `/api/ledger` present in the generated route manifest.
- Native job-server binary compilation with Bun.
- 23 engine/import/coverage tests: multi-day resumes, unique watched ranges, seek/rewind/pause rejection, tentative and completed rewatches, near-end resumes, accurate import overlap, undated history, confirmed Smallville baseline, legacy duplicate endpoints, reversible corrections, quoted CSV, bulk setup/invalid dates, intentional manual logs, per-day activity for resumed watches, preservation of metadata during list/rating edits, and safe poster paths.
- 5 API tests: authentication, server boundary, fixed authenticated-user scope, cross-origin write rejection, validated/scoped manual logs, and required episode identity.
- 13 existing poller-duration, persistence, and alternate-version item resolver regressions.
- The additive ledger migration executed on PostgreSQL WASM (PGlite); tests verified source identity upserts, user scoping, transaction rollback, and foreign-key cascades.
- Import regression using the supplied files: 288 detailed JSON titles and 291 newer CSV titles combine into 291 titles; all 1,634 episode rows are parsed. Approximate and unknown dates are classified separately. The private source files are excluded from this package.
- Installer shell syntax and simulated Docker tests: Compose discovery including paths with spaces, read-only check, app-only upgrades, rollback, build failure, backup failure and launch-failure recovery.
- Browser inspection of static server-rendered output from the actual React component: header, counters, filters, calendar, recaps and dated cards. This visual fixture lacks the live Jellyfin item metadata and is not a validated migration result or live app test.
- Git whitespace/error checks.

Not run here:

- Docker image builds, container startup, or a real Jellyfin connection. The environment does not provide Docker. Use the included installer check on the Ubuntu server and review container health after installation.
- Live end-to-end import and editing through the browser. API and database operations were tested separately.
- Mobile browser interaction.

Reproduce the core checks with Bun installed:

```bash
bun install --frozen-lockfile
bun run build:database
bun run typecheck
bun test apps/nextjs-app/lib/ledger/__tests__/engine.test.ts apps/job-server/src/jobs/watch-coverage.test.ts
(cd apps/nextjs-app && bun test lib/ledger/__tests__/api.test.ts)
bun test apps/job-server/src/jobs/session-poller.test.ts apps/job-server/src/jobs/session-poller-persistence.test.ts apps/job-server/src/jobs/session-item-resolver.test.ts
bun run build:nextjs
```

The upstream migration snapshots have a pre-existing branching collision between 0042 and 0043. Generation of 0045 temporarily set aside the older colliding snapshot, then restored it byte-for-byte. Only the newly generated ledger table statements were retained in the new SQL; existing enabled-folder and performance-index migrations are not repeated. Existing migration files were not changed. This generation issue does not affect applying the already-generated SQL through the existing migration runner.

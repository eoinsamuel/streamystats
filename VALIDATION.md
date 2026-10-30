# Watch Ledger validation

Review follow-up, 2026-10-30, based on fork main `8e9d1ec0d4caf3334de2f83639856294871f4a91`.

Passed:

- Both app TypeScript checks.
- Next.js production compilation, including the ledger page and API.
- 56 relevant tests: 22 engine/import, 11 API/access/cache, four paginated-view, one PostgreSQL integration, five coverage/final-position, and 13 existing poller/persistence/resolver regressions.
- The PostgreSQL integration executes the actual ledger migration and persistence code against PGlite. It verifies unrelated concurrent patches survive, older imports retain newer episodes and dates, equivalent manual retries insert once, conflicting key reuse is rejected, user scope is isolated, corrections reset, and old setup-day labels recover their stored source date without rewriting the import.
- The paginated-view tests verify 205 watches across three pages with no lost entries or partial recap totals, search/date filtering before paging, and the exclusion of completed multi-day watches from In progress.
- Installer shell syntax and mocked Docker discovery, paths containing spaces, read-only checks, app-only deployment, rollback, and build/backup/launch failure recovery.
- Native job-server binary compilation.
- Static rendering of the actual Ledger component: 100 cards, import badges, watch-status filter, pagination, and no setup-day control.
- Git whitespace checks.

Reproduce with Bun:

```bash
bun install --frozen-lockfile
bun run build:database
bun run typecheck
bun test apps/nextjs-app/lib/ledger/__tests__
bun test apps/job-server/src/jobs/watch-coverage.test.ts apps/job-server/src/jobs/session-poller.test.ts apps/job-server/src/jobs/session-poller-persistence.test.ts apps/job-server/src/jobs/session-item-resolver.test.ts
bun run build:nextjs
```

No live Docker, Jellyfin, or end-to-end browser validation was available for this follow-up. The user's existing containers and database were not modified. No new database schema migration is required. Poll-only seek/final-position limitations and supported history limits are documented in WATCH-LEDGER.md; the review findings and resolutions are in REVIEW-FIXES.md.

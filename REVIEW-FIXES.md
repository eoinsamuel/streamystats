# Watch Ledger review follow-up

The review covers the supplied 14 comments and removes personal import-date defaults. It also includes the previously delivered History watch-status filter.

| Comment | Resolution |
| --- | --- |
| 1. Former administrators | Other-user access and user listing revalidate current administrator privileges with Jellyfin. Failure falls back to own-user access. |
| 2. Older imports erase history | Per-user transactions serialize source writes; history merges by episode identity and retains later dates. Importing an older snapshot cannot remove known episodes. |
| 3. Concurrent edits | Corrections and sparse settings patches merge with the current JSONB payload in PostgreSQL. The settings form sends only fields changed from its opening snapshot. |
| 4. Manual-log retries | The browser reuses a stable request key until success. PostgreSQL treats equal retries as a no-op and rejects reuse for different content. |
| 5. Small seeks | Mitigated: forward progression is restricted to elapsed time plus bounded jitter, and explicit seek observations are rejected. Polling alone cannot identify every seek or playback rate. See the documented limitations. |
| 6. Final playback position | Matching final observations from unfiltered session data are applied before persistence. Missing final observations are not extrapolated; the last unobserved segment remains unknowable without a playback-event feed. |
| 7. Anime identity | TV and anime can match by provider identity or unambiguous title/year. Movies remain distinct. |
| 8. Unbounded reads/rendering | Narrow projections, explicit source limits, short-lived tagged caching, 100-card history pages, and 100-title list pages. Totals are computed from complete supported history. Oversize data is rejected explicitly. |
| 9. Wrapped cache | The shared ledger tag expires immediately on writes and correction resets, covering all years. |
| 10. Timestamp precision | Manual/correction/import dates use six fractional digits in UTC. Existing source microseconds are retained through offset normalization. |
| 11. Wrapped artwork | Ranked items query the matching Jellyfin item image tags. |
| 12. Ownership documentation | Imports, corrections, and settings explicitly belong to the selected user. |
| 13. Legacy rewatch regression | The test now checks `rewatch: false`, as well as the watch count. |
| 14. Import enrichment regression | The test now checks that the resulting sources contain SIMKL. |

The poll-only limitations in comments 5 and 6 are documented rather than claiming that unobservable data can be recovered. No database schema migration is required. Runtime data is not rewritten.

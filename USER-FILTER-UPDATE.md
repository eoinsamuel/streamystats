# Watch Ledger user filter update

Apply over the existing streamystats-watch-ledger source folder, then run
`bash install-ledger.sh --install` from that folder. The installer builds the
updated web image, backs up the database, and recreates the app containers.
No new database migration is needed. Keep the source folder and backups.

The User dropdown defaults to the signed-in user. Admins may choose another
user on the same server. Regular accounts see their own user only. History,
calendar, weekly/monthly recaps, totals, lists, settings, imports, corrections,
and manual logging all follow the selected user. The selected user's name
appears above the controls. Select your own user before importing your SIMKL
files. Selection is saved in the page URL and works with browser back/forward.
Controls pause while switching to prevent edits under an outdated selection.

Includes the configurable-port health-check correction in both the Compose
override and web Dockerfile, preserving your PORT=3020 configuration.

Validation: web TypeScript check; nine API tests including admin/non-admin
read and write boundaries; twenty existing watch-engine/import tests. Next.js production compilation passed. Live Docker and
live multi-user browser verification require your server.

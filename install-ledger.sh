#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP='streamystat-nextjs-app-1'
JOB='streamystat-job-server-1'
DB='streamystat-vectorchord-1'
MODE="${1:---install}"
case "$MODE" in --install|--rollback|--check) ;; *) printf 'Usage: bash install-ledger.sh [--install|--rollback|--check]\n' >&2; exit 2;; esac
command -v docker >/dev/null
docker compose version >/dev/null
project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$APP")"
compose_dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$APP")"
config_list="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$APP")"
[[ -n "$project" && "$project" != '<no value>' && -d "$compose_dir" ]] || { printf 'Cannot locate the existing Compose project. No changes made.\n' >&2; exit 1; }
args=(--project-directory "$compose_dir" --project-name "$project")
IFS=',' read -ra config_paths <<< "$config_list"
base_count=0
for config in "${config_paths[@]}"; do
  [[ "$(basename -- "$config")" == 'docker-compose.ledger.yml' ]] && continue
  [[ -f "$config" ]] || { printf 'Original Compose file is missing: %s\n' "$config" >&2; exit 1; }
  args+=(-f "$config");base_count=$((base_count+1))
done
(( base_count>0 )) || { printf 'No original Compose files found.\n' >&2; exit 1; }
services="$(docker compose "${args[@]}" config --services)"
for expected in nextjs-app job-server vectorchord; do
  [[ $'\n'"$services"$'\n' == *$'\n'"$expected"$'\n'* ]] || { printf 'Expected service is missing: %s\n' "$expected" >&2; exit 1; }
done
printf 'Located Compose project %s in %s.\n' "$project" "$compose_dir"
if [[ "$MODE" == --check ]]; then printf 'Check complete. No containers changed.\n'; exit 0; fi
if [[ "$MODE" == --rollback ]]; then
  docker compose "${args[@]}" up -d --no-deps job-server nextjs-app
  printf 'Original Compose images restored. Ledger records remain in the database.\n'
  exit 0
fi
printf 'Building custom images. Existing services keep running during the builds.\n'
docker build -t streamystats-watch-ledger-web:0.1.0 -f "$SOURCE_DIR/apps/nextjs-app/Dockerfile" "$SOURCE_DIR"
docker build -t streamystats-watch-ledger-jobs:0.1.0 -f "$SOURCE_DIR/apps/job-server/Dockerfile" "$SOURCE_DIR"
restarting=()
for container in "$JOB" "$APP"; do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$container")" == true ]]; then restarting+=("$container");fi
done
finished=false
recover() {
 if [[ "$finished" != true ]]; then
   printf 'Installation did not finish; restarting the previous app images.\n' >&2
   if ! docker compose "${args[@]}" up -d --no-deps job-server nextjs-app; then
     printf 'Automatic recovery failed. Use the original Compose project to restart the apps.\n' >&2
   fi
 fi
}
trap recover EXIT
if (( ${#restarting[@]} )); then docker stop -t 60 "${restarting[@]}" >/dev/null;fi
backup_dir="$(mktemp -d "$SOURCE_DIR/pre-ledger-backup-XXXXXXXX")"
printf 'Backing up the existing database to %s\n' "$backup_dir/database.dump"
docker exec "$DB" sh -c 'exec pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-streamystats}" -Fc' > "$backup_dir/database.dump"
[[ -s "$backup_dir/database.dump" ]]
docker exec -i "$DB" pg_restore --list < "$backup_dir/database.dump" > "$backup_dir/contents.txt"
# Only the app services are recreated. In particular, the database image and
# database volume are taken from the original project and are not recreated.
docker compose "${args[@]}" -f "$SOURCE_DIR/docker-compose.ledger.yml" up -d --no-deps --wait --wait-timeout 240 job-server nextjs-app
finished=true
printf '\nInstalled. Open Streamystats and choose Watch Ledger in the sidebar.\n'
printf 'Import the older SIMKL JSON, then the newer SIMKL CSV from the history page.\n'
printf 'Backup: %s\n' "$backup_dir/database.dump"

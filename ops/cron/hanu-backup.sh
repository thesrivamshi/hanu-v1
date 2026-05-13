#!/bin/bash
# Hanu nightly Postgres dump.
# Cron entry (/etc/cron.d/hanu-backup):
#   0 3 * * * root /usr/local/bin/hanu-backup.sh >/var/log/hanu/backup.log 2>&1
#
# Requires: SUPABASE_DB_URL env var (or .env source) with a postgres:// URL.
# Retains 14 days of dumps locally. Push to off-droplet storage (S3 / B2 / your
# Mac via rsync) separately if you care about losing the droplet.

set -euo pipefail

ENV_FILE="${HANU_BACKUP_ENV:-/root/.hermes/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "[hanu-backup] SUPABASE_DB_URL not set; aborting" >&2
  exit 1
fi

OUT_DIR="/var/backups/hanu"
OUT_FILE="$OUT_DIR/hanu-$(date +%Y%m%d_%H%M%S).sql.gz"
mkdir -p "$OUT_DIR"

pg_dump "$SUPABASE_DB_URL" | gzip > "$OUT_FILE"
echo "[hanu-backup] wrote $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

find "$OUT_DIR" -name 'hanu-*.sql.gz' -mtime +14 -delete

#!/usr/bin/env bash
# Dagelijkse back-up van de HQ-database (geld, experimenten, lessen). Paperclip maakt zelf elk uur back-ups.
# Bewaart 14 dagen in ~/backups. Kopieer af en toe een back-up naar een andere plek (bv. je laptop):
#   scp ai@<server>:backups/hq-*.sql.gz .
set -euo pipefail
env_file="${HQ_ENV_FILE:-$HOME/.config/hq/hq.env}"
# Alleen DATABASE_URL uitlezen (het env-bestand is voor systemd/Node, niet om in bash te 'sourcen').
db_url="$(grep -E '^DATABASE_URL=' "$env_file" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
if [[ -z "$db_url" ]]; then
  echo "DATABASE_URL niet gevonden in $env_file" >&2
  exit 1
fi
mkdir -p "$HOME/backups"
file="$HOME/backups/hq-$(date +%F).sql.gz"
pg_dump --no-owner --no-privileges "$db_url" | gzip > "$file"
find "$HOME/backups" -name 'hq-*.sql.gz' -mtime +14 -delete
echo "Back-up: $file ($(du -h "$file" | cut -f1))"
# Terugzetten (eerst HQ stoppen):  gunzip -c hq-JJJJ-MM-DD.sql.gz | psql "<DATABASE_URL>"

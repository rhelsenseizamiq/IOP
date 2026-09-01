#!/bin/bash
# Nightly PaloAlto -> IPAM sync wrapper. Runs via cron (ansible user).
set -euo pipefail

BASE=/opt/IOP
ENV_FILE="$BASE/.env.paloalto"
SCRIPT_HOST="$BASE/scripts/paloalto_sync.py"
LOGDIR="$BASE/logs/paloalto_sync"
LOCKFILE=/tmp/paloalto_sync.lock
LOCK_MAX_AGE_SECONDS=7200  # 2h — well beyond the few seconds this normally takes

mkdir -p "$LOGDIR"
LOGFILE="$LOGDIR/$(date +%Y%m%d_%H%M%S).log"

if [ -e "$LOCKFILE" ]; then
    lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCKFILE") ))
    if [ "$lock_age" -gt "$LOCK_MAX_AGE_SECONDS" ]; then
        echo "$(date -u '+%Y-%m-%d %H:%M:%S') Stale lock (${lock_age}s old, host crash/reboot?) - clearing and proceeding" >> "$LOGFILE"
        rm -f "$LOCKFILE"
    else
        echo "$(date -u '+%Y-%m-%d %H:%M:%S') Previous sync still running (lock present at $LOCKFILE, ${lock_age}s old) - skipping this run" >> "$LOGFILE"
        exit 0
    fi
fi
touch "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

set -a
source "$ENV_FILE"
set +a

{
    echo "=== PaloAlto sync starting: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
    sudo docker cp "$SCRIPT_HOST" iop-api:/app/paloalto_sync.py
    sudo docker exec -e PALOALTO_HOSTS="$PALOALTO_HOSTS" -e PALOALTO_USERNAME="$PALOALTO_USERNAME" -e PALOALTO_PASSWORD="$PALOALTO_PASSWORD" iop-api python /app/paloalto_sync.py
    echo "=== PaloAlto sync finished: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
} >> "$LOGFILE" 2>&1

# Keep the last 30 days of logs only
find "$LOGDIR" -name "*.log" -mtime +30 -delete

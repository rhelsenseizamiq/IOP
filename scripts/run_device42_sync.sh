#!/bin/bash
# Nightly Device42 -> IPAM sync wrapper. Runs via cron (ansible user).
set -euo pipefail

BASE=/opt/IOP
ENV_FILE="$BASE/.env.device42"
SCRIPT_HOST="$BASE/scripts/device42_sync.py"
LOGDIR="$BASE/logs/device42_sync"
LOCKFILE=/tmp/device42_sync.lock
LOCK_MAX_AGE_SECONDS=7200  # 2h — well beyond the ~25min this normally takes

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
    echo "=== Device42 sync starting: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
    sudo docker cp "$SCRIPT_HOST" iop-api:/app/device42_sync.py
    sudo docker exec -e D42_HOST="$D42_HOST" -e D42_USER="$D42_USER" -e D42_PASS="$D42_PASS" iop-api python /app/device42_sync.py
    echo "=== Device42 sync finished: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
} >> "$LOGFILE" 2>&1

# Keep the last 30 days of logs only
find "$LOGDIR" -name "*.log" -mtime +30 -delete

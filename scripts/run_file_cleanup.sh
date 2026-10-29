#!/bin/bash
# Nightly expired-file cleanup. Runs via cron (ansible user).
set -euo pipefail

BASE=/opt/IOP
SCRIPT_HOST="$BASE/scripts/file_cleanup.py"
LOGDIR="$BASE/logs/file_cleanup"
LOCKFILE=/tmp/file_cleanup.lock
LOCK_MAX_AGE_SECONDS=1800  # short job (DB sweep + a few blob deletes), same budget as anomaly_digest

# Created here, as whichever user cron runs this as (ansible) — see
# run_vcenter_sync.sh's own comment for why this matters: a log dir
# created by an earlier manual `sudo` test run breaks every subsequent
# plain-user cron run silently.
mkdir -p "$LOGDIR"
LOGFILE="$LOGDIR/$(date +%Y%m%d_%H%M%S).log"

if [ -e "$LOCKFILE" ]; then
    lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCKFILE") ))
    if [ "$lock_age" -gt "$LOCK_MAX_AGE_SECONDS" ]; then
        echo "$(date -u '+%Y-%m-%d %H:%M:%S') Stale lock (${lock_age}s old, host crash/reboot?) - clearing and proceeding" >> "$LOGFILE"
        rm -f "$LOCKFILE"
    else
        echo "$(date -u '+%Y-%m-%d %H:%M:%S') Previous run still in progress (lock present at $LOCKFILE, ${lock_age}s old) - skipping this run" >> "$LOGFILE"
        exit 0
    fi
fi
touch "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

{
    echo "=== file cleanup starting: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
    sudo docker cp "$SCRIPT_HOST" iop-api:/app/file_cleanup.py
    sudo docker exec iop-api python /app/file_cleanup.py
    echo "=== file cleanup finished: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
} >> "$LOGFILE" 2>&1

# Keep the last 30 days of logs only
find "$LOGDIR" -name "*.log" -mtime +30 -delete

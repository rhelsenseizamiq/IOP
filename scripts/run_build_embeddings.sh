#!/bin/bash
# Nightly AI-assistant embedding index build. Runs via cron (ansible user).
set -euo pipefail

BASE=/opt/IOP
SCRIPT_HOST="$BASE/scripts/build_embeddings.py"
LOGDIR="$BASE/logs/build_embeddings"
LOCKFILE=/tmp/build_embeddings.lock
LOCK_MAX_AGE_SECONDS=7200

# Created here, as whichever user cron runs this as (ansible) — NOT via a
# manual sudo test run first. A prior script (run_vcenter_sync.sh) had its
# log directory created root-owned by an earlier manual `sudo` test run,
# which silently broke every subsequent cron-run (plain ansible user
# couldn't write to it) for a week before anyone noticed. Don't repeat that.
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
    echo "=== embedding build starting: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
    sudo docker cp "$SCRIPT_HOST" iop-api:/app/build_embeddings.py
    sudo docker exec iop-api python /app/build_embeddings.py
    echo "=== embedding build finished: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
} >> "$LOGFILE" 2>&1

# Keep the last 30 days of logs only
find "$LOGDIR" -name "*.log" -mtime +30 -delete

#!/bin/bash
# Nightly Dashboard anomaly digest. Runs via cron (ansible user).
set -euo pipefail

BASE=/opt/IOP
SCRIPT_HOST="$BASE/scripts/anomaly_digest.py"
LOGDIR="$BASE/logs/anomaly_digest"
LOCKFILE=/tmp/anomaly_digest.lock
LOCK_MAX_AGE_SECONDS=1800  # this job is short (no data to enumerate, at
# most one short LLM call) — 30 min is already generous, not the 2h used
# by the longer sync jobs.

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
    echo "=== anomaly digest starting: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
    sudo docker cp "$SCRIPT_HOST" iop-api:/app/anomaly_digest.py
    sudo docker exec iop-api python /app/anomaly_digest.py
    echo "=== anomaly digest finished: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="
} >> "$LOGFILE" 2>&1

# Keep the last 30 days of logs only
find "$LOGDIR" -name "*.log" -mtime +30 -delete

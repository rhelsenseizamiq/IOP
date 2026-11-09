#!/bin/bash
# Nightly backup: MongoDB (mongodump, gzip archive) + the File Sharing
# feature's encrypted blob storage (tar.gz). Runs via cron (ansible user).
#
# Deliberately NOT `set -e`: a failed step here must still fall through
# to the status-recording step at the end (backup_status.py writes
# sync_status with status=error and the reason) instead of the whole
# script just dying under cron with nothing visible on the Dashboard —
# same "always report, even on failure" shape as every *_sync.py's own
# try/except -> always write sync_status.
set -uo pipefail

BASE=/opt/IOP
BACKUP_ROOT=/data/iop-backups
MONGO_BACKUP_DIR="$BACKUP_ROOT/mongodb"
FILES_BACKUP_DIR="$BACKUP_ROOT/file-storage"
STATUS_SCRIPT_HOST="$BASE/scripts/backup_status.py"
LOGDIR="$BASE/logs/backup"
LOCKFILE=/tmp/iop_backup.lock
LOCK_MAX_AGE_SECONDS=7200  # 2h — same headroom as device42/vcenter syncs
RETENTION_DAYS=14           # /data had 139G free as of 2026-10-30 against a
                             # ~550MB DB and a near-empty file-storage tree —
                             # plenty of room; raise this later if needed

mkdir -p "$LOGDIR"
LOGFILE="$LOGDIR/$(date +%Y%m%d_%H%M%S).log"

# /data is root:root 755 — ansible can't mkdir directly under it (same
# reason /data/iop-file-storage needed its own chmod fix back in the
# File Sharing deployment). Create once, idempotently, then hand
# ownership to ansible so every later write in this script is a plain
# unprivileged one.
if [ ! -d "$BACKUP_ROOT" ]; then
    sudo mkdir -p "$MONGO_BACKUP_DIR" "$FILES_BACKUP_DIR"
    sudo chown -R ansible:ansible "$BACKUP_ROOT"
fi

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
    START=$(date +%s)
    echo "=== backup starting: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ==="

    STAMP=$(date -u +%Y%m%d_%H%M%S)
    MONGO_FILE="$MONGO_BACKUP_DIR/mongodb_${STAMP}.archive.gz"
    FILES_FILE="$FILES_BACKUP_DIR/file-storage_${STAMP}.tar.gz"
    ERROR=""

    echo "--- mongodump ---"
    if sudo docker exec iop-mongodb sh -c \
        'mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db ipam --archive --gzip' \
        > "$MONGO_FILE"; then
        echo "mongodump OK: $(du -h "$MONGO_FILE" | cut -f1)"
    else
        echo "mongodump FAILED"
        ERROR="mongodump failed"
        rm -f "$MONGO_FILE"
    fi

    echo "--- file-storage archive ---"
    # root:clamscan 750 (see README's File Sharing / ClamAV section) —
    # ansible's passwordless sudo reads it fine, a plain tar would not.
    # Output to stdout (-), redirected outside the sudo'd command — same
    # reason the mongodump line above works this way: sudo is only needed
    # to READ the root:clamscan directory, the resulting file should still
    # end up ansible-owned, not root-owned.
    if sudo tar czf - -C /data/iop-file-storage . > "$FILES_FILE"; then
        echo "file-storage archive OK: $(du -h "$FILES_FILE" | cut -f1)"
    else
        echo "file-storage archive FAILED"
        ERROR="${ERROR:+$ERROR; }file-storage archive failed"
        rm -f "$FILES_FILE"
    fi

    MONGO_BYTES=0
    [ -f "$MONGO_FILE" ] && MONGO_BYTES=$(stat -c %s "$MONGO_FILE")
    FILES_BYTES=0
    [ -f "$FILES_FILE" ] && FILES_BYTES=$(stat -c %s "$FILES_FILE")

    echo "--- retention cleanup (keep last ${RETENTION_DAYS} days) ---"
    find "$MONGO_BACKUP_DIR" -name "*.archive.gz" -mtime "+${RETENTION_DAYS}" -print -delete
    find "$FILES_BACKUP_DIR" -name "*.tar.gz" -mtime "+${RETENTION_DAYS}" -print -delete

    END=$(date +%s)
    DURATION=$(( END - START ))

    echo "--- recording status ---"
    STATUS="ok"
    STATUS_ARGS=(--status ok --duration "$DURATION" --mongodb-bytes "$MONGO_BYTES" --file-storage-bytes "$FILES_BYTES" --kept-days "$RETENTION_DAYS")
    if [ -n "$ERROR" ]; then
        STATUS="error"
        STATUS_ARGS=(--status error --duration "$DURATION" --mongodb-bytes "$MONGO_BYTES" --file-storage-bytes "$FILES_BYTES" --kept-days "$RETENTION_DAYS" --error "$ERROR")
    fi
    sudo docker cp "$STATUS_SCRIPT_HOST" iop-api:/app/backup_status.py
    sudo docker exec iop-api python /app/backup_status.py "${STATUS_ARGS[@]}"

    echo "=== backup finished: $(date -u '+%Y-%m-%d %H:%M:%S') UTC — status=$STATUS, duration=${DURATION}s ==="
} >> "$LOGFILE" 2>&1

# Keep the last 30 days of logs only
find "$LOGDIR" -name "*.log" -mtime +30 -delete

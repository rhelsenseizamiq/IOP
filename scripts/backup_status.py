"""
Writes the `sync_status` doc (_id: "backup") for the nightly backup job,
so the Dashboard's existing "Data Sync Health" card picks it up the same
way it already does for device42/zabbix/paloalto/vcenter/ai_embeddings —
no new UI needed for status display, just one more row.

The actual backup work (mongodump, tar of the file-storage directory,
retention cleanup) happens in scripts/run_backup.sh, entirely in bash on
the HOST — it needs `docker exec iop-mongodb mongodump` and direct
filesystem access to /data, neither of which this container has reason
to do. This script is only the last step: take the numbers run_backup.sh
already computed (passed as CLI args) and record them in Mongo, reusing
this app's own already-configured DB connection instead of inventing a
separate credential path for a one-line write.

Run inside the iop-api container:
    docker exec iop-api python /app/backup_status.py \\
        --status ok --duration 12.3 \\
        --mongodb-bytes 1048576 --file-storage-bytes 2097152 \\
        --kept-days 14 [--error "..."]
"""
import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone

from app.core.database import connect_to_mongo, close_mongo_connection, get_database

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("backup_status")


async def main(args: argparse.Namespace) -> None:
    await connect_to_mongo()
    db = get_database()

    try:
        await db["sync_status"].update_one(
            {"_id": "backup"},
            {"$set": {
                "last_run_at": datetime.now(timezone.utc),
                "status": args.status,
                "duration_seconds": args.duration,
                "counters": {
                    "mongodb_backup_mb": round(args.mongodb_bytes / 1024 / 1024, 1),
                    "file_storage_backup_mb": round(args.file_storage_bytes / 1024 / 1024, 1),
                    "kept_days": args.kept_days,
                },
                "error": args.error,
            }},
            upsert=True,
        )
        log.info("wrote sync_status for backup: status=%s duration=%.1fs", args.status, args.duration)
    except Exception:
        log.exception("failed to write sync_status")
    finally:
        await close_mongo_connection()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", choices=["ok", "error"], required=True)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--mongodb-bytes", type=int, required=True)
    parser.add_argument("--file-storage-bytes", type=int, required=True)
    parser.add_argument("--kept-days", type=int, required=True)
    parser.add_argument("--error", type=str, default=None)
    asyncio.run(main(parser.parse_args()))

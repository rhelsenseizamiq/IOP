"""
Nightly expired-file cleanup for the File Sharing feature.

Every uploaded file carries an expires_at the UPLOADER THEMSELVES chose
at upload time (required, capped at 30 days — see
app/services/file_service.py's validate_expires_at()). This app never
decides on its own that a file should go away; it only ever acts on a
date a human already set. This job is just the mechanism that actually
enforces that date once it arrives — FileService.cleanup_expired() does
the real work (delete the Mongo record, then the on-disk encrypted blob,
same ordering as every other delete path in this app), this script is
just the nightly trigger for it.

Run inside the iop-api container:
    docker exec iop-api python /app/file_cleanup.py
"""
import asyncio
import logging
import sys
import time

from app.core.database import connect_to_mongo, close_mongo_connection, get_database
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.file_repository import FileRepository
from app.services.file_service import FileService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("file_cleanup")


async def main() -> None:
    start = time.time()
    await connect_to_mongo()
    db = get_database()

    run_error: str | None = None
    removed = 0

    try:
        service = FileService(
            file_repo=FileRepository(db["files"]),
            audit_repo=AuditLogRepository(db["audit_logs"]),
        )
        removed = await service.cleanup_expired()
        log.info("removed %d expired file(s)", removed)
    except Exception as exc:
        run_error = str(exc)
        log.exception("file cleanup failed")

    duration = time.time() - start
    log.info("=== DONE in %.1fs — %d file(s) removed ===", duration, removed)

    await close_mongo_connection()

    if run_error:
        raise RuntimeError(run_error)


if __name__ == "__main__":
    asyncio.run(main())

import hashlib
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, Optional

import aiofiles
from fastapi import HTTPException, UploadFile, status

from app.config import get_settings
from app.core import file_vault
from app.core.clamav import ScanVerdict, scan_file
from app.models.audit_log import AuditAction, ResourceType
from app.models.file import FileEntry, FileVisibility, ScanStatus
from app.models.user import Role
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.file_repository import FileRepository
from app.schemas.file import FileResponse, FileUpdate

logger = logging.getLogger(__name__)

_CHUNK_SIZE = 1024 * 1024  # 1 MiB — matches core/file_vault's own chunking

# The uploader must explicitly pick a deletion date for their own file —
# this app will never delete a file on its own authority without the
# uploader's say-so (see cleanup_expired() below, which only ever acts on
# an expires_at the uploader themselves set). Capped at 30 days so storage
# doesn't grow unbounded from files nobody ever comes back to manage.
MAX_FILE_RETENTION = timedelta(days=30)


def validate_expires_at(expires_at: datetime) -> datetime:
    """Required on every upload. Normalizes a naive datetime to UTC (Mongo
    hands back naive datetimes on read — see the same fix already applied
    to ShareLink/FileEntry/User — this runs on the raw Form value before it
    round-trips through Mongo, so it needs its own normalization here)."""
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="expires_at must be in the future",
        )
    if expires_at > now + MAX_FILE_RETENTION:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"expires_at cannot be more than {MAX_FILE_RETENTION.days} days from now",
        )
    return expires_at


def _to_response(entry: FileEntry) -> FileResponse:
    return FileResponse(
        id=entry.id, filename=entry.filename, content_type=entry.content_type,
        size_bytes=entry.size_bytes, sha256=entry.sha256, description=entry.description,
        tags=entry.tags, scan_status=entry.scan_status, visibility=entry.visibility,
        delete_after_first_download=entry.delete_after_first_download,
        expires_at=entry.expires_at, created_at=entry.created_at, updated_at=entry.updated_at,
        created_by=entry.created_by, updated_by=entry.updated_by,
    )


def _can_see(entry: FileEntry, username: str, role: str) -> bool:
    if entry.visibility == FileVisibility.ORG:
        return True
    return entry.created_by == username or role in (Role.ADMINISTRATOR.value, Role.SUPER_ADMIN.value)


class FileService:
    def __init__(self, file_repo: FileRepository, audit_repo: AuditLogRepository) -> None:
        self._files = file_repo
        self._audit = audit_repo
        self._settings = get_settings()

    def _staging_dir(self) -> str:
        return os.path.join(self._settings.FILE_STORAGE_ROOT, "staging")

    def _final_path(self, created_at: datetime) -> str:
        shard = created_at.strftime("%Y/%m")
        return os.path.join(self._settings.FILE_STORAGE_ROOT, shard, f"{uuid.uuid4()}.bin")

    @staticmethod
    def _cleanup_quiet(path: Optional[str]) -> None:
        if not path:
            return
        try:
            os.remove(path)
        except OSError:
            pass

    async def upload(
        self,
        upload_file: UploadFile,
        description: Optional[str],
        tags: list[str],
        username: str,
        user_role: str,
        client_ip: str,
        expires_at: datetime,
        visibility: FileVisibility = FileVisibility.ORG,
        delete_after_first_download: bool = False,
    ) -> tuple[FileResponse, str]:
        """Streams the upload to a temp plaintext staging file (never held
        whole in memory), enforcing the size cap as bytes arrive. Returns
        the created record PLUS the staging path — the caller (router) is
        responsible for scheduling process_scan_and_encrypt as a background
        task, since scanning a large file could plausibly exceed any
        reasonable HTTP request timeout if done synchronously.

        expires_at is required — see validate_expires_at()'s docstring for
        why: this app never deletes a file on its own authority, only on
        the uploader's own say-so."""
        expires_at = validate_expires_at(expires_at)
        os.makedirs(self._staging_dir(), exist_ok=True)
        staging_path = os.path.join(self._staging_dir(), f"{uuid.uuid4()}.tmp")

        sha256 = hashlib.sha256()
        size = 0
        try:
            async with aiofiles.open(staging_path, "wb") as dest:
                while True:
                    chunk = await upload_file.read(_CHUNK_SIZE)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > self._settings.MAX_FILE_SIZE_BYTES:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"File exceeds the {self._settings.MAX_FILE_SIZE_BYTES}-byte limit",
                        )
                    sha256.update(chunk)
                    await dest.write(chunk)
        except Exception:
            self._cleanup_quiet(staging_path)
            raise

        now = datetime.now(timezone.utc)
        doc = {
            "filename": upload_file.filename or "unnamed",
            "content_type": upload_file.content_type or "application/octet-stream",
            "size_bytes": size,
            "storage_path": None,
            "wrapped_dek": None,
            "dek_iv": None,
            "file_iv": None,
            "sha256": sha256.hexdigest(),
            "description": description,
            "tags": tags,
            "scan_status": ScanStatus.PENDING.value,
            "visibility": visibility.value,
            "delete_after_first_download": delete_after_first_download,
            "expires_at": expires_at,
            "created_at": now,
            "updated_at": now,
            "created_by": username,
            "updated_by": username,
        }
        entry = await self._files.create(doc)

        await self._audit.log(
            action=AuditAction.UPLOAD, resource_type=ResourceType.FILE,
            username=username, user_role=user_role, client_ip=client_ip,
            resource_id=entry.id, detail=f"Uploaded {entry.filename} ({size} bytes), scan pending",
        )
        return _to_response(entry), staging_path

    async def process_scan_and_encrypt(self, file_id: str, staging_path: str) -> None:
        """Background task (scheduled by the router via FastAPI
        BackgroundTasks): scan the plaintext staging file, and ONLY on a
        clean result, encrypt it into permanent storage. Fails closed on
        any scan problem — scan_failed leaves the file blocked, never
        silently treated as usable. This is the corrected ordering from the
        plan's own self-review: encryption happens AFTER a clean scan, not
        before — ClamAV cannot scan an encrypted blob."""
        entry = await self._files.find_by_id(file_id)
        if entry is None:
            self._cleanup_quiet(staging_path)
            return

        verdict, signature = scan_file(staging_path)

        if verdict == ScanVerdict.CLEAN:
            dek = file_vault.generate_dek()
            wrapped_dek, dek_iv = file_vault.wrap_dek(self._settings.VAULT_MASTER_KEY, dek)
            final_path = self._final_path(entry.created_at)
            os.makedirs(os.path.dirname(final_path), exist_ok=True)
            file_iv = await file_vault.encrypt_file(dek, staging_path, final_path)
            self._cleanup_quiet(staging_path)
            await self._files.update(file_id, {
                "storage_path": final_path, "wrapped_dek": wrapped_dek,
                "dek_iv": dek_iv, "file_iv": file_iv, "scan_status": ScanStatus.CLEAN.value,
            })
        elif verdict == ScanVerdict.INFECTED:
            self._cleanup_quiet(staging_path)
            await self._files.update(file_id, {"scan_status": ScanStatus.INFECTED.value})
            await self._audit.log(
                action=AuditAction.MALWARE_DETECTED, resource_type=ResourceType.FILE,
                username=entry.created_by, user_role="n/a", client_ip="n/a",
                resource_id=file_id,
                detail=f"Infected upload blocked and deleted: {entry.filename} ({signature})",
            )
        else:  # SCAN_FAILED — left exactly as scan_status: pending->scan_failed, blocked either way
            await self._files.update(file_id, {"scan_status": ScanStatus.SCAN_FAILED.value})
            logger.error("Scan failed for file %s (%s) — left blocked, not available", file_id, entry.filename)

    async def list_files(
        self, filter_: dict, username: str, role: str, skip: int = 0, limit: int = 50,
    ) -> tuple[list[FileResponse], int]:
        # Visibility filtering happens at the query layer, not post-filtered
        # in Python, so pagination totals stay correct.
        visible_filter = {
            "$or": [
                {"visibility": FileVisibility.ORG.value},
                {"created_by": username},
            ]
        }
        if role in (Role.ADMINISTRATOR.value, Role.SUPER_ADMIN.value):
            visible_filter = {}  # admins see everything, including owner_only
        combined = {**filter_, **visible_filter} if visible_filter else filter_
        entries, total = await self._files.find_all(combined, skip=skip, limit=limit, sort=[("created_at", -1)])
        return [_to_response(e) for e in entries], total

    async def get_by_id(self, file_id: str, username: str, role: str) -> FileResponse:
        entry = await self._files.find_by_id(file_id)
        if entry is None or not _can_see(entry, username, role):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        return _to_response(entry)

    def _decrypt_stream_for(self, entry: FileEntry) -> AsyncIterator[bytes]:
        if entry.scan_status != ScanStatus.CLEAN:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"File is not available for download (status: {entry.scan_status.value})",
            )
        dek = file_vault.unwrap_dek(self._settings.VAULT_MASTER_KEY, entry.wrapped_dek, entry.dek_iv)
        return file_vault.decrypt_file_stream(dek, entry.file_iv, entry.storage_path)

    async def get_download_stream(
        self, file_id: str, username: str, role: str, client_ip: str,
    ) -> tuple[FileEntry, AsyncIterator[bytes]]:
        """Owner-gated download — the normal, authenticated GET
        /files/{id}/download path. Checks visibility/RBAC via _can_see."""
        entry = await self._files.find_by_id(file_id)
        if entry is None or not _can_see(entry, username, role):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        stream = self._decrypt_stream_for(entry)
        await self._audit.log(
            action=AuditAction.DOWNLOAD, resource_type=ResourceType.FILE,
            username=username, user_role=role, client_ip=client_ip,
            resource_id=file_id, detail=f"Downloaded {entry.filename}",
        )
        return entry, stream

    def get_download_stream_anonymous(self, entry: FileEntry) -> AsyncIterator[bytes]:
        """For the public share-link download path (app/services/
        share_service.py) — the share token itself is the authorization,
        not RBAC/ownership, so this deliberately skips _can_see and does
        NOT write its own audit entry (the caller, ShareService, already
        logs a SHARE_VIEW for this exact access)."""
        return self._decrypt_stream_for(entry)

    async def delete_after_download_if_set(self, file_id: str) -> None:
        """Called by the router as a FastAPI BackgroundTask AFTER the
        StreamingResponse has fully sent — never mid-stream. Deletes the
        database record first, then the on-disk blob, same ordering as
        every other delete path in this app."""
        entry = await self._files.find_by_id(file_id)
        if entry is None or not entry.delete_after_first_download:
            return
        storage_path = entry.storage_path
        await self._files.delete(file_id)
        self._cleanup_quiet(storage_path)

    async def update(
        self, file_id: str, data: FileUpdate, username: str, role: str, client_ip: str,
    ) -> FileResponse:
        entry = await self._files.find_by_id(file_id)
        if entry is None or not _can_see(entry, username, role):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        update_fields = data.model_dump(exclude_none=True)
        update_fields["updated_by"] = username
        updated = await self._files.update(file_id, update_fields)
        await self._audit.log(
            action=AuditAction.UPDATE, resource_type=ResourceType.FILE,
            username=username, user_role=role, client_ip=client_ip,
            resource_id=file_id, detail=f"Updated {entry.filename}",
        )
        return _to_response(updated)

    async def delete(self, file_id: str, username: str, role: str, client_ip: str) -> None:
        entry = await self._files.find_by_id(file_id)
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        storage_path = entry.storage_path
        await self._files.delete(file_id)
        self._cleanup_quiet(storage_path)
        await self._audit.log(
            action=AuditAction.DELETE, resource_type=ResourceType.FILE,
            username=username, user_role=role, client_ip=client_ip,
            resource_id=file_id, detail=f"Deleted {entry.filename}",
        )

    async def cleanup_expired(self) -> int:
        """Called by the nightly scripts/file_cleanup.sh job. Returns the
        number of files removed."""
        expired = await self._files.find_expired(datetime.now(timezone.utc))
        for entry in expired:
            self._cleanup_quiet(entry.storage_path)
            await self._files.delete(entry.id)
            await self._audit.log(
                action=AuditAction.DELETE, resource_type=ResourceType.FILE,
                username="system", user_role="system", client_ip="internal",
                resource_id=entry.id, detail=f"Expired (TTL): {entry.filename}",
            )
        return len(expired)

import ipaddress
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

from fastapi import HTTPException, UploadFile, status

from app.config import get_settings
from app.core.password import hash_password, verify_password
from app.core.vault import decrypt_password
from app.models.audit_log import AuditAction, ResourceType
from app.models.file import FileVisibility
from app.models.share_link import ShareLink, ShareLinkType, ShareResourceType
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.file_repository import FileRepository
from app.repositories.password_repository import PasswordRepository
from app.repositories.share_link_repository import ShareLinkRepository
from app.schemas.file import FileResponse
from app.schemas.share_link import (
    ShareLinkCreate,
    ShareLinkResponse,
    SharedFileResponse,
    SharedPasswordResponse,
    UploadLinkInfo,
    UploadRequestCreate,
)
from app.services.file_service import MAX_FILE_RETENTION, FileService

logger = logging.getLogger(__name__)

# RFC1918 + loopback — matches this app's own network, used ONLY to decide
# whether a password-type share link may be resolved from this request's
# origin. File-type links have no such restriction (see plan §3/§5).
_INTERNAL_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
]


def _is_internal(client_ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    return any(addr in net for net in _INTERNAL_NETWORKS)


def _to_response(link: ShareLink, base_url: str) -> ShareLinkResponse:
    # Upload-type links open the frontend's /upload/:token page (a plain
    # upload box) — NOT /share/:token, which calls GET /share/{token} and
    # would 404 for an upload-type token (that endpoint only resolves
    # DOWNLOAD links; see resolve_metadata).
    path = "upload" if link.link_type == ShareLinkType.UPLOAD else "share"
    return ShareLinkResponse(
        id=link.id, share_url=f"{base_url.rstrip('/')}/{path}/{link.token}",
        link_type=link.link_type, resource_type=link.resource_type,
        expires_at=link.expires_at, max_views=link.max_views, view_count=link.view_count,
        note=link.note, is_revoked=link.is_revoked, has_password=bool(link.password_hash),
        created_at=link.created_at, created_by=link.created_by,
    )


class ShareService:
    def __init__(
        self,
        share_repo: ShareLinkRepository,
        password_repo: PasswordRepository,
        file_repo: FileRepository,
        file_service: FileService,
        audit_repo: AuditLogRepository,
    ) -> None:
        self._shares = share_repo
        self._passwords = password_repo
        self._files = file_repo
        self._file_service = file_service
        self._audit = audit_repo
        self._settings = get_settings()

    # ── Creation (authenticated — Operator+, enforced at the router) ──────

    async def create_download_link(
        self,
        resource_type: ShareResourceType,
        resource_id: str,
        data: ShareLinkCreate,
        username: str,
        role: str,
        client_ip: str,
    ) -> ShareLinkResponse:
        if resource_type == ShareResourceType.PASSWORD_ENTRY:
            resource = await self._passwords.find_by_id(resource_id)
        else:
            resource = await self._files.find_by_id(resource_id)
        if resource is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")

        expires_at = None
        if data.expires_in_hours:
            expires_at = datetime.now(timezone.utc) + timedelta(hours=data.expires_in_hours)

        now = datetime.now(timezone.utc)
        doc = {
            "token": secrets.token_urlsafe(32),
            "link_type": ShareLinkType.DOWNLOAD.value,
            "resource_type": resource_type.value,
            "resource_id": resource_id,
            "expires_at": expires_at,
            "max_views": data.max_views or 0,
            "view_count": 0,
            "note": data.note,
            "is_revoked": False,
            "password_hash": hash_password(data.password) if data.password else None,
            "created_at": now,
            "updated_at": now,
            "created_by": username,
            "updated_by": username,
        }
        link = await self._shares.create(doc)
        await self._audit.log(
            action=AuditAction.SHARE_CREATE, resource_type=ResourceType.SHARE_LINK,
            username=username, user_role=role, client_ip=client_ip,
            resource_id=link.id, detail=f"Created download link for {resource_type.value}:{resource_id}",
        )
        return _to_response(link, self._settings.PUBLIC_BASE_URL)

    async def create_upload_link(
        self, data: UploadRequestCreate, username: str, role: str, client_ip: str,
    ) -> ShareLinkResponse:
        expires_at = None
        if data.expires_in_hours:
            expires_at = datetime.now(timezone.utc) + timedelta(hours=data.expires_in_hours)

        now = datetime.now(timezone.utc)
        doc = {
            "token": secrets.token_urlsafe(32),
            "link_type": ShareLinkType.UPLOAD.value,
            "resource_type": ShareResourceType.FILE.value,
            "resource_id": None,
            "expires_at": expires_at,
            "max_views": 1,  # always exactly one upload — see plan §1
            "view_count": 0,
            "note": data.note,
            "is_revoked": False,
            "password_hash": hash_password(data.password) if data.password else None,
            "created_at": now,
            "updated_at": now,
            "created_by": username,
            "updated_by": username,
        }
        link = await self._shares.create(doc)
        await self._audit.log(
            action=AuditAction.SHARE_CREATE, resource_type=ResourceType.SHARE_LINK,
            username=username, user_role=role, client_ip=client_ip,
            resource_id=link.id, detail="Created upload-request link",
        )
        return _to_response(link, self._settings.PUBLIC_BASE_URL)

    async def list_for_resource(
        self, resource_type: ShareResourceType, resource_id: str,
    ) -> list[ShareLinkResponse]:
        links = await self._shares.find_for_resource(resource_type.value, resource_id)
        return [_to_response(l, self._settings.PUBLIC_BASE_URL) for l in links]

    async def list_for_owner(self, username: str, active_only: bool = False) -> list[ShareLinkResponse]:
        links = await self._shares.find_for_owner(username, active_only=active_only)
        return [_to_response(l, self._settings.PUBLIC_BASE_URL) for l in links]

    async def revoke(self, share_id: str, username: str, role: str, client_ip: str) -> None:
        link = await self._shares.find_by_id(share_id)
        if link is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
        await self._shares.update(share_id, {"is_revoked": True, "updated_by": username})
        await self._audit.log(
            action=AuditAction.SHARE_REVOKE, resource_type=ResourceType.SHARE_LINK,
            username=username, user_role=role, client_ip=client_ip,
            resource_id=share_id, detail="Revoked share link",
        )

    # ── Public resolution (anonymous — no auth at all) ────────────────────

    def _peek_usable(self, link: ShareLink, client_ip: str) -> None:
        """Read-only gate check — does NOT consume a view. Used for the
        metadata call on file-type links, so just looking at a share page
        doesn't burn a one-time link's single use; actually downloading
        does (see resolve_file_download)."""
        if link.is_revoked:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This link has been revoked.")
        if link.expires_at and datetime.now(timezone.utc) > link.expires_at:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This link has expired.")
        # max_views == 0 means unlimited (see ShareLinkCreate) — only gate
        # when a real cap was set.
        if link.max_views > 0 and link.view_count >= link.max_views:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This link has already been used.")
        if link.resource_type == ShareResourceType.PASSWORD_ENTRY and not _is_internal(client_ip):
            # Same response as "token doesn't exist" — never confirm a
            # restricted token's validity to an external requester.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found.")

    def _check_password(self, link: ShareLink, password: Optional[str]) -> None:
        if not link.password_hash:
            return
        if not password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="password_required")
        if not verify_password(password, link.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect passphrase.")

    async def resolve_metadata(
        self, token: str, client_ip: str, password: Optional[str] = None,
    ) -> Union[SharedPasswordResponse, SharedFileResponse]:
        """For a password link: full gate + atomic consume + decrypt, all
        in one call (the password IS the content, there's no separate
        download step). For a file link: a non-consuming peek only — the
        real download/consume happens in resolve_file_download."""
        link = await self._shares.find_by_token(token)
        if link is None or link.link_type != ShareLinkType.DOWNLOAD:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found.")

        self._peek_usable(link, client_ip)
        self._check_password(link, password)

        if link.resource_type == ShareResourceType.PASSWORD_ENTRY:
            consumed = await self._shares.try_consume_view(token)
            if consumed is None:
                raise HTTPException(status_code=status.HTTP_410_GONE, detail="This link has already been used.")
            entry = await self._passwords.find_by_id(link.resource_id)
            if entry is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found.")
            plaintext = decrypt_password(
                self._settings.VAULT_MASTER_KEY, entry.cabinet_id, entry.ciphertext, entry.iv,
            )
            await self._audit.log(
                action=AuditAction.SHARE_VIEW, resource_type=ResourceType.SHARE_LINK,
                username="anonymous", user_role="n/a", client_ip=client_ip,
                resource_id=link.id, detail="Password share viewed",
            )
            return SharedPasswordResponse(
                entry_title=entry.title, username=entry.username, password=plaintext,
                url=entry.url, note=link.note, expires_at=link.expires_at,
                view_count=consumed.view_count, max_views=link.max_views,
            )

        file_entry = await self._files.find_by_id(link.resource_id)
        if file_entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found.")
        return SharedFileResponse(
            file_id=file_entry.id, filename=file_entry.filename, size_bytes=file_entry.size_bytes,
            content_type=file_entry.content_type, note=link.note, expires_at=link.expires_at,
            view_count=link.view_count, max_views=link.max_views,
        )

    async def resolve_file_download(self, token: str, client_ip: str, password: Optional[str] = None):
        """The actual byte-serving path for a file-type download link —
        this is what consumes the link's one use, not the metadata call.
        Returns (FileEntry, decrypted_chunk_iterator) for the router to
        wrap in a StreamingResponse."""
        link = await self._shares.find_by_token(token)
        if link is None or link.link_type != ShareLinkType.DOWNLOAD or link.resource_type != ShareResourceType.FILE:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found.")

        self._peek_usable(link, client_ip)
        self._check_password(link, password)

        consumed = await self._shares.try_consume_view(token)
        if consumed is None:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This link has already been used.")

        file_entry = await self._files.find_by_id(link.resource_id)
        if file_entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found.")

        await self._audit.log(
            action=AuditAction.SHARE_VIEW, resource_type=ResourceType.SHARE_LINK,
            username="anonymous", user_role="n/a", client_ip=client_ip,
            resource_id=link.id, detail=f"File share downloaded: {file_entry.filename}",
        )
        stream = self._file_service.get_download_stream_anonymous(file_entry)
        return file_entry, stream

    async def peek_upload_link(self, token: str, client_ip: str) -> UploadLinkInfo:
        """What the public upload page shows BEFORE a file is submitted —
        lets the frontend render a password prompt or an "already used"
        state without needing a real upload attempt first. Deliberately
        returns `valid: false` (never a distinct error) for anything
        wrong — not found, wrong type, expired, revoked, already used —
        so this can't be used to distinguish those cases from outside."""
        link = await self._shares.find_by_token(token)
        if link is None or link.link_type != ShareLinkType.UPLOAD:
            return UploadLinkInfo(valid=False, has_password=False, note=None, expires_at=None)
        try:
            self._peek_usable(link, client_ip)
        except HTTPException:
            return UploadLinkInfo(valid=False, has_password=False, note=None, expires_at=None)
        return UploadLinkInfo(
            valid=True, has_password=bool(link.password_hash),
            note=link.note, expires_at=link.expires_at,
        )

    async def accept_upload(
        self, token: str, upload_file: UploadFile, client_ip: str, password: Optional[str] = None,
    ) -> tuple[FileResponse, str]:
        """Accepts a guest upload against an upload-type link. The single
        use is reserved BEFORE the upload is streamed in (not after) —
        prevents two concurrent submissions both succeeding against a
        max_views: 1 link; if the upload itself then fails, the link is
        simply spent (matches how one-time codes generally behave)."""
        link = await self._shares.find_by_token(token)
        if link is None or link.link_type != ShareLinkType.UPLOAD:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found.")

        self._peek_usable(link, client_ip)
        self._check_password(link, password)

        consumed = await self._shares.try_consume_view(token)
        if consumed is None:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This link has already been used.")

        response, staging_path = await self._file_service.upload(
            upload_file=upload_file,
            description=f"Received via guest upload link ({link.note or 'no label'})",
            tags=[],
            username=link.created_by,
            user_role="n/a",
            client_ip=client_ip,
            visibility=FileVisibility.OWNER_ONLY,
            # The anonymous guest has no UI step to pick a date (unlike the
            # authenticated upload form), so this defaults to the maximum
            # allowed retention rather than leaving it unset — every file,
            # guest-uploaded or not, gets a real expiry someone can act on.
            expires_at=datetime.now(timezone.utc) + MAX_FILE_RETENTION,
        )
        await self._shares.update(link.id, {"resource_id": response.id})
        await self._audit.log(
            action=AuditAction.SHARE_VIEW, resource_type=ResourceType.SHARE_LINK,
            username="anonymous", user_role="n/a", client_ip=client_ip,
            resource_id=link.id, detail=f"Guest upload accepted: {response.filename} (owner: {link.created_by})",
        )
        return response, staging_path

import logging
from typing import Annotated, Optional, Union

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Path, Request, UploadFile, status
from fastapi.responses import StreamingResponse

from app.core.database import get_database
from app.core.rate_limiter import limiter
from app.dependencies.auth import require_role
from app.models.share_link import ShareResourceType
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.file_repository import FileRepository
from app.repositories.password_repository import PasswordRepository
from app.repositories.share_link_repository import ShareLinkRepository
from app.schemas.share_link import (
    ShareLinkCreate,
    ShareLinkResponse,
    SharedFileResponse,
    SharedPasswordResponse,
    SharePasswordUnlockRequest,
    UploadLinkInfo,
)
from app.schemas.file import FileResponse
from app.services.file_service import FileService
from app.services.share_service import ShareService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["shares"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator", "SuperAdmin")
_OPERATOR_PLUS = require_role("Operator", "Administrator", "SuperAdmin")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_share_service(db=None) -> ShareService:
    if db is None:
        db = get_database()
    file_service = FileService(
        file_repo=FileRepository(db["files"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )
    return ShareService(
        share_repo=ShareLinkRepository(db["share_links"]),
        password_repo=PasswordRepository(db["password_entries"]),
        file_repo=FileRepository(db["files"]),
        file_service=file_service,
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


# ── Authenticated — password-entry share management ────────────────────
# Same paths the existing (already-built) Vault frontend already calls —
# ShareModal.tsx needs no changes to keep working.

@router.get("/passwords/{id}/shares", response_model=list[ShareLinkResponse])
async def list_password_shares(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> list[ShareLinkResponse]:
    service = _build_share_service()
    return await service.list_for_resource(ShareResourceType.PASSWORD_ENTRY, id)


@router.post("/passwords/{id}/shares", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
async def create_password_share(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: ShareLinkCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> ShareLinkResponse:
    service = _build_share_service()
    return await service.create_download_link(
        resource_type=ShareResourceType.PASSWORD_ENTRY, resource_id=id, data=body,
        username=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request),
    )


@router.delete("/passwords/shares/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_password_share(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    # Tightened from Viewer+ (what the original, never-shipped design
    # documented) to Operator+ — a Viewer shouldn't be able to revoke
    # someone else's share link. See plan's self-review.
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> None:
    service = _build_share_service()
    await service.revoke(id, username=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request))


@router.delete("/files/shares/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_file_share(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> None:
    service = _build_share_service()
    await service.revoke(id, username=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request))


# ── Public, fully anonymous — no Depends(require_role(...)) at all ─────
# Rate limits: two SEPARATE zones. Viewing/unlocking/downloading something
# that already exists gets the looser one; uploading (the one path where an
# anonymous party writes data into this system) gets the tighter one — see
# plan §5. Both also sit behind nginx's own, separate, tighter rate-limit
# zones as a second, independent layer (infra-level, not visible here).

@router.get("/share/{token}", response_model=Union[SharedPasswordResponse, SharedFileResponse])
@limiter.limit("20/minute")
async def view_share(token: str, request: Request):
    service = _build_share_service()
    return await service.resolve_metadata(token, client_ip=_get_client_ip(request))


@router.get("/share/{token}/upload-info", response_model=UploadLinkInfo)
@limiter.limit("20/minute")
async def view_upload_link(token: str, request: Request):
    """What the public upload page (not yet submitting a file) checks
    first — separate from GET /share/{token} since an upload-type link
    has no resource content to describe yet."""
    service = _build_share_service()
    return await service.peek_upload_link(token, client_ip=_get_client_ip(request))


@router.post("/share/{token}/unlock", response_model=Union[SharedPasswordResponse, SharedFileResponse])
@limiter.limit("20/minute")
async def unlock_share(token: str, request: Request, body: SharePasswordUnlockRequest):
    """Same as GET /share/{token}, but carries the passphrase in a POST
    body instead of a query string — passphrases should never land in
    server access logs or browser history."""
    service = _build_share_service()
    return await service.resolve_metadata(token, client_ip=_get_client_ip(request), password=body.password)


@router.post("/share/{token}/download")
@limiter.limit("20/minute")
async def download_shared_file(
    token: str, request: Request, background_tasks: BackgroundTasks, password: Optional[str] = Form(default=None),
) -> StreamingResponse:
    service = _build_share_service()
    entry, stream = await service.resolve_file_download(token, client_ip=_get_client_ip(request), password=password)
    return StreamingResponse(
        stream, media_type=entry.content_type,
        headers={"Content-Disposition": f'attachment; filename="{entry.filename}"'},
    )


@router.post("/share/{token}/upload", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def upload_to_share(
    token: str,
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    password: Optional[str] = Form(default=None),
) -> FileResponse:
    """What an anonymous vendor hits after opening an upload-request link
    — no login, no IOP account, just the token. See plan §3a."""
    service = _build_share_service()
    response, staging_path = await service.accept_upload(
        token, upload_file=file, client_ip=_get_client_ip(request), password=password,
    )
    file_service = FileService(
        file_repo=FileRepository(get_database()["files"]),
        audit_repo=AuditLogRepository(get_database()["audit_logs"]),
    )
    background_tasks.add_task(file_service.process_scan_and_encrypt, response.id, staging_path)
    return response

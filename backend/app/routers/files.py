import logging
import re
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Path, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.file import FileVisibility
from app.models.share_link import ShareResourceType
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.file_repository import FileRepository
from app.repositories.share_link_repository import ShareLinkRepository
from app.repositories.password_repository import PasswordRepository
from app.schemas.audit_log import PaginatedResponse
from app.schemas.file import FileResponse, FileUpdate
from app.schemas.share_link import ShareLinkCreate, ShareLinkResponse, UploadRequestCreate
from app.services.file_service import FileService
from app.services.share_service import ShareService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/files", tags=["files"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator", "SuperAdmin")
_OPERATOR_PLUS = require_role("Operator", "Administrator", "SuperAdmin")
_ADMIN_ONLY = require_role("Administrator", "SuperAdmin")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_file_service(db=None) -> FileService:
    if db is None:
        db = get_database()
    return FileService(
        file_repo=FileRepository(db["files"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


def _build_share_service(db=None) -> ShareService:
    if db is None:
        db = get_database()
    return ShareService(
        share_repo=ShareLinkRepository(db["share_links"]),
        password_repo=PasswordRepository(db["password_entries"]),
        file_repo=FileRepository(db["files"]),
        file_service=_build_file_service(db),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.get("", response_model=PaginatedResponse[FileResponse])
async def list_files(
    request: Request,
    pagination: PaginationParams = Depends(),
    search: Optional[str] = Query(None),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PaginatedResponse[FileResponse]:
    filter_: dict = {}
    if search:
        escaped = re.escape(search)
        filter_["$or"] = [
            {"filename": {"$regex": escaped, "$options": "i"}},
            {"description": {"$regex": escaped, "$options": "i"}},
            {"tags": {"$regex": escaped, "$options": "i"}},
        ]
    service = _build_file_service()
    files, total = await service.list_files(
        filter_=filter_, username=current_user.sub, role=current_user.role.value,
        skip=pagination.skip, limit=pagination.page_size,
    )
    return PaginatedResponse.create(items=files, total=total, page=pagination.page, page_size=pagination.page_size)


@router.post("", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    description: Optional[str] = Form(default=None),
    tags: list[str] = Form(default=[]),
    delete_after_first_download: bool = Form(default=False),
    expires_at: datetime = Form(..., description="Required — max 30 days from now"),
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> FileResponse:
    service = _build_file_service()
    response, staging_path = await service.upload(
        upload_file=file, description=description, tags=tags,
        username=current_user.sub, user_role=current_user.role.value,
        client_ip=_get_client_ip(request), visibility=FileVisibility.ORG,
        delete_after_first_download=delete_after_first_download, expires_at=expires_at,
    )
    background_tasks.add_task(service.process_scan_and_encrypt, response.id, staging_path)
    return response


@router.get("/{id}", response_model=FileResponse)
async def get_file(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> FileResponse:
    service = _build_file_service()
    return await service.get_by_id(id, username=current_user.sub, role=current_user.role.value)


@router.get("/{id}/download")
async def download_file(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> StreamingResponse:
    service = _build_file_service()
    entry, stream = await service.get_download_stream(
        id, username=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request),
    )
    # Scheduled to run AFTER the response has fully streamed, never
    # mid-stream — see FileService.delete_after_download_if_set.
    background_tasks.add_task(service.delete_after_download_if_set, id)
    return StreamingResponse(
        stream, media_type=entry.content_type,
        headers={"Content-Disposition": f'attachment; filename="{entry.filename}"'},
        background=background_tasks,
    )


@router.patch("/{id}", response_model=FileResponse)
async def update_file(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: FileUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> FileResponse:
    service = _build_file_service()
    return await service.update(
        id, data=body, username=current_user.sub, role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> None:
    service = _build_file_service()
    await service.delete(
        id, username=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request),
    )


@router.get("/{id}/shares", response_model=list[ShareLinkResponse])
async def list_file_shares(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> list[ShareLinkResponse]:
    service = _build_share_service()
    return await service.list_for_resource(ShareResourceType.FILE, id)


@router.post("/{id}/shares", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
async def create_file_share(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: ShareLinkCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> ShareLinkResponse:
    service = _build_share_service()
    return await service.create_download_link(
        resource_type=ShareResourceType.FILE, resource_id=id, data=body,
        username=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request),
    )


@router.post("/upload-requests", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
async def create_upload_request(
    request: Request,
    body: UploadRequestCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> ShareLinkResponse:
    """Creates a guest upload link — no file attached yet, nothing exists
    to share. See app/services/share_service.py / plan §3a."""
    service = _build_share_service()
    return await service.create_upload_link(
        data=body, username=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request),
    )

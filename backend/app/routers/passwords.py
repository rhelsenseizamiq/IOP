import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Path, Query, Request, status
from fastapi.responses import JSONResponse

from app.core.database import get_database
from app.core.rate_limiter import limiter
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.cabinet_repository import CabinetRepository
from app.repositories.password_repository import PasswordRepository
from app.schemas.audit_log import PaginatedResponse
from app.schemas.password_entry import (
    PasswordEntryCreate,
    PasswordEntryDetailResponse,
    PasswordEntryResponse,
    PasswordEntryUpdate,
    PasswordMoveRequest,
    RevealResponse,
)
from app.services.password_service import PasswordService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/passwords", tags=["passwords"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator", "SuperAdmin")
_OPERATOR_PLUS = require_role("Operator", "Administrator", "SuperAdmin")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service() -> PasswordService:
    db = get_database()
    return PasswordService(
        password_repo=PasswordRepository(db["password_entries"]),
        cabinet_repo=CabinetRepository(db["cabinets"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.get("", response_model=PaginatedResponse[PasswordEntryResponse])
async def list_entries(
    request: Request,
    cabinet_id: str = Query(..., description="Cabinet ObjectId"),
    folder_id: Optional[str] = Query(default=None, description="Folder ObjectId (omit for all)"),
    pagination: PaginationParams = Depends(),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PaginatedResponse[PasswordEntryResponse]:
    service = _build_service()
    entries, total = await service.list_entries(
        cabinet_id=cabinet_id,
        username=current_user.sub,
        role=current_user.role.value,
        skip=pagination.skip,
        limit=pagination.page_size,
        folder_id=folder_id,
    )
    return PaginatedResponse.create(items=entries, total=total, page=pagination.page, page_size=pagination.page_size)


@router.get("/{id}/reveal", response_model=RevealResponse)
@limiter.limit("10/minute")
async def reveal_password(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> JSONResponse:
    service = _build_service()
    reveal, headers = await service.reveal_entry(
        entry_id=id, username=current_user.sub,
        role=current_user.role.value, client_ip=_get_client_ip(request),
    )
    return JSONResponse(content=reveal.model_dump(), headers=headers)


@router.get("/{id}", response_model=PasswordEntryDetailResponse)
async def get_entry(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PasswordEntryDetailResponse:
    service = _build_service()
    return await service.get_entry(entry_id=id, username=current_user.sub, role=current_user.role.value)


@router.post("", response_model=PasswordEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_entry(
    request: Request,
    body: PasswordEntryCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> PasswordEntryResponse:
    service = _build_service()
    return await service.create_entry(
        data=body, created_by=current_user.sub,
        role=current_user.role.value, client_ip=_get_client_ip(request),
    )


@router.patch("/{id}/move", response_model=PasswordEntryResponse)
async def move_entry(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: PasswordMoveRequest,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> PasswordEntryResponse:
    service = _build_service()
    return await service.move_entry(
        entry_id=id, folder_id=body.folder_id,
        updated_by=current_user.sub, role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.patch("/{id}", response_model=PasswordEntryResponse)
async def update_entry(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: PasswordEntryUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> PasswordEntryResponse:
    service = _build_service()
    return await service.update_entry(
        entry_id=id, data=body, updated_by=current_user.sub,
        role=current_user.role.value, client_ip=_get_client_ip(request),
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> None:
    service = _build_service()
    await service.delete_entry(
        entry_id=id, deleted_by=current_user.sub,
        role=current_user.role.value, client_ip=_get_client_ip(request),
    )

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.user import UserInToken
from app.repositories.aggregate_repository import AggregateRepository
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.rir_repository import RIRRepository
from app.schemas.audit_log import PaginatedResponse
from app.schemas.rir import RIRCreate, RIRResponse, RIRUpdate
from app.services.rir_service import RIRService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rirs", tags=["rirs"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator")
_ADMIN_ONLY = require_role("Administrator")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service(db=None) -> RIRService:
    if db is None:
        db = get_database()
    return RIRService(
        rir_repo=RIRRepository(db["rirs"]),
        aggregate_repo=AggregateRepository(db["aggregates"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.get("", response_model=PaginatedResponse[RIRResponse])
async def list_rirs(
    request: Request,
    pagination: PaginationParams = Depends(),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PaginatedResponse[RIRResponse]:
    service = _build_service()
    rirs, total = await service.list_rirs(skip=pagination.skip, limit=pagination.page_size)
    return PaginatedResponse.create(
        items=rirs, total=total, page=pagination.page, page_size=pagination.page_size
    )


@router.post("", response_model=RIRResponse, status_code=status.HTTP_201_CREATED)
async def create_rir(
    request: Request,
    body: RIRCreate,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> RIRResponse:
    service = _build_service()
    return await service.create(
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.get("/{id}", response_model=RIRResponse)
async def get_rir(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> RIRResponse:
    service = _build_service()
    return await service.get_by_id(id)


@router.put("/{id}", response_model=RIRResponse)
async def update_rir(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: RIRUpdate,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> RIRResponse:
    service = _build_service()
    return await service.update(
        id=id,
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rir(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> None:
    service = _build_service()
    await service.delete(
        id=id,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Path, Query, Request, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.ip_range_repository import IPRangeRepository
from app.repositories.subnet_repository import SubnetRepository
from app.schemas.audit_log import PaginatedResponse
from app.schemas.ip_range import IPRangeCreate, IPRangeResponse, IPRangeUpdate
from app.services.ip_range_service import IPRangeService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ip-ranges", tags=["ip-ranges"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator")
_OPERATOR_PLUS = require_role("Operator", "Administrator")
_ADMIN_ONLY = require_role("Administrator")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service(db=None) -> IPRangeService:
    if db is None:
        db = get_database()
    return IPRangeService(
        ip_range_repo=IPRangeRepository(db["ip_ranges"]),
        subnet_repo=SubnetRepository(db["subnets"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.get("", response_model=PaginatedResponse[IPRangeResponse])
async def list_ip_ranges(
    request: Request,
    pagination: PaginationParams = Depends(),
    subnet_id: Optional[str] = Query(..., description="Filter by subnet ID (required)"),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PaginatedResponse[IPRangeResponse]:
    service = _build_service()
    ranges, total = await service.list_by_subnet(
        subnet_id=subnet_id, skip=pagination.skip, limit=pagination.page_size
    )
    return PaginatedResponse.create(
        items=ranges, total=total, page=pagination.page, page_size=pagination.page_size
    )


@router.post("", response_model=IPRangeResponse, status_code=status.HTTP_201_CREATED)
async def create_ip_range(
    request: Request,
    body: IPRangeCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> IPRangeResponse:
    service = _build_service()
    return await service.create(
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.get("/{id}", response_model=IPRangeResponse)
async def get_ip_range(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> IPRangeResponse:
    service = _build_service()
    return await service.get_by_id(id)


@router.put("/{id}", response_model=IPRangeResponse)
async def update_ip_range(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: IPRangeUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> IPRangeResponse:
    service = _build_service()
    return await service.update(
        id=id,
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ip_range(
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

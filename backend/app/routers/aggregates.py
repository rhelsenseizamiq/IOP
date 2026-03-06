import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Path, Query, Request, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.user import UserInToken
from app.repositories.aggregate_repository import AggregateRepository
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.rir_repository import RIRRepository
from app.repositories.subnet_repository import SubnetRepository
from app.schemas.aggregate import AggregateCreate, AggregateResponse, AggregateUpdate
from app.schemas.audit_log import PaginatedResponse
from app.services.aggregate_service import AggregateService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/aggregates", tags=["aggregates"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator")
_OPERATOR_PLUS = require_role("Operator", "Administrator")
_ADMIN_ONLY = require_role("Administrator")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service(db=None) -> AggregateService:
    if db is None:
        db = get_database()
    return AggregateService(
        aggregate_repo=AggregateRepository(db["aggregates"]),
        rir_repo=RIRRepository(db["rirs"]),
        subnet_repo=SubnetRepository(db["subnets"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.get("", response_model=PaginatedResponse[AggregateResponse])
async def list_aggregates(
    request: Request,
    pagination: PaginationParams = Depends(),
    rir_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PaginatedResponse[AggregateResponse]:
    import re
    filter_: dict = {}
    if rir_id:
        filter_["rir_id"] = rir_id
    if search:
        escaped = re.escape(search)
        filter_["$or"] = [
            {"prefix": {"$regex": escaped, "$options": "i"}},
            {"description": {"$regex": escaped, "$options": "i"}},
        ]
    service = _build_service()
    aggs, total = await service.list_aggregates(
        filter_=filter_, skip=pagination.skip, limit=pagination.page_size
    )
    return PaginatedResponse.create(
        items=aggs, total=total, page=pagination.page, page_size=pagination.page_size
    )


@router.post("", response_model=AggregateResponse, status_code=status.HTTP_201_CREATED)
async def create_aggregate(
    request: Request,
    body: AggregateCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> AggregateResponse:
    service = _build_service()
    return await service.create(
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.get("/{id}", response_model=AggregateResponse)
async def get_aggregate(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> AggregateResponse:
    service = _build_service()
    return await service.get_by_id(id)


@router.put("/{id}", response_model=AggregateResponse)
async def update_aggregate(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: AggregateUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> AggregateResponse:
    service = _build_service()
    return await service.update(
        id=id,
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_aggregate(
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

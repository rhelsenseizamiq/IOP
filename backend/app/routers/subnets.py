import logging
import re
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Path, Query, Request, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.ip_record import Environment
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.ip_record_repository import IPRecordRepository
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.vrf_repository import VRFRepository
from app.schemas.audit_log import PaginatedResponse
from app.schemas.subnet import SubnetCreate, SubnetDetailResponse, SubnetResponse, SubnetTreeNode, SubnetUpdate
from app.services.subnet_service import SubnetService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/subnets", tags=["subnets"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator")
_OPERATOR_PLUS = require_role("Operator", "Administrator")
_ADMIN_ONLY = require_role("Administrator")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service(db=None) -> SubnetService:
    if db is None:
        db = get_database()
    return SubnetService(
        subnet_repo=SubnetRepository(db["subnets"]),
        ip_repo=IPRecordRepository(db["ip_records"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
        vrf_repo=VRFRepository(db["vrfs"]),
    )


@router.get("/tree", response_model=list[SubnetTreeNode])
async def get_subnet_tree(
    request: Request,
    vrf_id: Optional[str] = Query(None, description="Filter by VRF ID (None = global)"),
    environment: Optional[Environment] = Query(None),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> list[SubnetTreeNode]:
    service = _build_service()
    return await service.build_tree(vrf_id=vrf_id, environment=environment)


@router.get("", response_model=PaginatedResponse[SubnetDetailResponse])
async def list_subnets(
    request: Request,
    pagination: PaginationParams = Depends(),
    environment: Optional[Environment] = Query(None),
    search: Optional[str] = Query(None, description="Search by name or CIDR"),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PaginatedResponse[SubnetDetailResponse]:
    filter_: dict = {}
    if environment:
        filter_["environment"] = environment.value
    if search:
        escaped = re.escape(search)
        filter_["$or"] = [
            {"name": {"$regex": escaped, "$options": "i"}},
            {"cidr": {"$regex": escaped, "$options": "i"}},
        ]

    service = _build_service()
    subnets, total = await service.list_subnets(
        filter_=filter_,
        skip=pagination.skip,
        limit=pagination.page_size,
    )
    return PaginatedResponse.create(
        items=subnets,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("", response_model=SubnetResponse, status_code=status.HTTP_201_CREATED)
async def create_subnet(
    request: Request,
    body: SubnetCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> SubnetResponse:
    service = _build_service()
    return await service.create(
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.get("/{id}", response_model=SubnetDetailResponse)
async def get_subnet(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> SubnetDetailResponse:
    service = _build_service()
    return await service.get_detail(id)


@router.put("/{id}", response_model=SubnetResponse)
async def update_subnet(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: SubnetUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> SubnetResponse:
    service = _build_service()
    return await service.update(
        id=id,
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.patch("/{id}", response_model=SubnetResponse)
async def patch_subnet(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: SubnetUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> SubnetResponse:
    service = _build_service()
    return await service.update(
        id=id,
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subnet(
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

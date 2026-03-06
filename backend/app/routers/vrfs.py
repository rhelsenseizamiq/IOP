import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.vrf_repository import VRFRepository
from app.schemas.audit_log import PaginatedResponse
from app.schemas.vrf import VRFCreate, VRFResponse, VRFUpdate
from app.services.vrf_service import VRFService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/vrfs", tags=["vrfs"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator")
_OPERATOR_PLUS = require_role("Operator", "Administrator")
_ADMIN_ONLY = require_role("Administrator")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service(db=None) -> VRFService:
    if db is None:
        db = get_database()
    return VRFService(
        vrf_repo=VRFRepository(db["vrfs"]),
        subnet_repo=SubnetRepository(db["subnets"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.get("", response_model=PaginatedResponse[VRFResponse])
async def list_vrfs(
    request: Request,
    pagination: PaginationParams = Depends(),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PaginatedResponse[VRFResponse]:
    service = _build_service()
    vrfs, total = await service.list_vrfs(skip=pagination.skip, limit=pagination.page_size)
    return PaginatedResponse.create(
        items=vrfs, total=total, page=pagination.page, page_size=pagination.page_size
    )


@router.post("", response_model=VRFResponse, status_code=status.HTTP_201_CREATED)
async def create_vrf(
    request: Request,
    body: VRFCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> VRFResponse:
    service = _build_service()
    return await service.create(
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.get("/{id}", response_model=VRFResponse)
async def get_vrf(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> VRFResponse:
    service = _build_service()
    return await service.get_by_id(id)


@router.put("/{id}", response_model=VRFResponse)
async def update_vrf(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: VRFUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> VRFResponse:
    service = _build_service()
    return await service.update(
        id=id,
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vrf(
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

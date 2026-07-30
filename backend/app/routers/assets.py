import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.asset import AssetStatus, AssetType
from app.models.user import UserInToken
from app.repositories.asset_repository import AssetRepository
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.ip_record_repository import IPRecordRepository
from app.schemas.asset import AssetCreate, AssetResponse, AssetUpdate
from app.schemas.audit_log import PaginatedResponse
from app.services.asset_service import AssetService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assets", tags=["assets"])

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator", "SuperAdmin")
_OPERATOR_PLUS = require_role("Operator", "Administrator", "SuperAdmin")
_ADMIN_ONLY = require_role("Administrator", "SuperAdmin")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service() -> AssetService:
    db = get_database()
    return AssetService(
        asset_repo=AssetRepository(db["assets"]),
        ip_repo=IPRecordRepository(db["ip_records"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.get("", response_model=PaginatedResponse[AssetResponse])
async def list_assets(
    request: Request,
    pagination: PaginationParams = Depends(),
    asset_type: Optional[AssetType] = Query(None),
    status: Optional[AssetStatus] = Query(None),
    data_center: Optional[str] = Query(None),
    search: Optional[str] = Query(None, description="Search by name, hostname, or serial number"),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PaginatedResponse[AssetResponse]:
    svc = _build_service()
    skip = (pagination.page - 1) * pagination.page_size
    items, total = await svc.list_assets(
        asset_type=asset_type.value if asset_type else None,
        status=status.value if status else None,
        data_center=data_center,
        search=search,
        skip=skip,
        limit=pagination.page_size,
    )
    return PaginatedResponse.create(
        items=items,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("", response_model=AssetResponse, status_code=201)
async def create_asset(
    body: AssetCreate,
    request: Request,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> AssetResponse:
    svc = _build_service()
    return await svc.create(
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(
    asset_id: str,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> AssetResponse:
    svc = _build_service()
    return await svc.get_by_id(asset_id)


@router.put("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: str,
    body: AssetUpdate,
    request: Request,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> AssetResponse:
    svc = _build_service()
    return await svc.update(
        asset_id=asset_id,
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.delete("/{asset_id}", status_code=204)
async def delete_asset(
    asset_id: str,
    request: Request,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> None:
    svc = _build_service()
    await svc.delete(
        asset_id=asset_id,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )

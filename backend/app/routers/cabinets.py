import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.cabinet_repository import CabinetRepository
from app.repositories.password_repository import PasswordRepository
from app.repositories.user_repository import UserRepository
from app.schemas.cabinet import CabinetCreate, CabinetResponse, CabinetUpdate, MembersUpdate
from app.services.cabinet_service import CabinetService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cabinets", tags=["cabinets"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_VIEWER_PLUS  = require_role("Viewer", "Operator", "Administrator", "SuperAdmin")
_ADMIN_PLUS   = require_role("Administrator", "SuperAdmin")
_SUPER_ADMIN  = require_role("SuperAdmin")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service() -> CabinetService:
    db = get_database()
    return CabinetService(
        cabinet_repo=CabinetRepository(db["cabinets"]),
        password_repo=PasswordRepository(db["password_entries"]),
        user_repo=UserRepository(db["users"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.get("", response_model=list[CabinetResponse])
async def list_cabinets(request: Request, current_user: UserInToken = Depends(_VIEWER_PLUS)):
    service = _build_service()
    return await service.list_cabinets(username=current_user.sub, role=current_user.role.value)


@router.post("", response_model=CabinetResponse, status_code=status.HTTP_201_CREATED)
async def create_cabinet(request: Request, body: CabinetCreate, current_user: UserInToken = Depends(_ADMIN_PLUS)):
    service = _build_service()
    return await service.create_cabinet(data=body, created_by=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request))


@router.get("/{id}", response_model=CabinetResponse)
async def get_cabinet(id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)], request: Request, current_user: UserInToken = Depends(_VIEWER_PLUS)):
    service = _build_service()
    return await service.get_cabinet(cabinet_id=id, username=current_user.sub, role=current_user.role.value)


@router.patch("/{id}", response_model=CabinetResponse)
async def update_cabinet(id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)], request: Request, body: CabinetUpdate, current_user: UserInToken = Depends(_ADMIN_PLUS)):
    service = _build_service()
    return await service.update_cabinet(cabinet_id=id, data=body, updated_by=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request))


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cabinet(id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)], request: Request, current_user: UserInToken = Depends(_SUPER_ADMIN)):
    service = _build_service()
    await service.delete_cabinet(cabinet_id=id, deleted_by=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request))


@router.post("/{id}/members", response_model=CabinetResponse)
async def add_cabinet_members(id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)], request: Request, body: MembersUpdate, current_user: UserInToken = Depends(_ADMIN_PLUS)):
    service = _build_service()
    return await service.add_members(cabinet_id=id, usernames=body.usernames, updated_by=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request))


@router.delete("/{id}/members/{username}", response_model=CabinetResponse)
async def remove_cabinet_member(id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)], username: str, request: Request, current_user: UserInToken = Depends(_ADMIN_PLUS)):
    service = _build_service()
    return await service.remove_member(cabinet_id=id, username=username, updated_by=current_user.sub, role=current_user.role.value, client_ip=_get_client_ip(request))

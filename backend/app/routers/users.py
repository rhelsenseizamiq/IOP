import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.user_repository import UserRepository
from app.schemas.audit_log import PaginatedResponse
from app.schemas.user import UserCreate, UserResponse, UserResetPassword, UserUpdate
from app.services.user_service import UserService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users", tags=["users"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"

_ADMIN_ONLY = require_role("Administrator")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service(db=None) -> UserService:
    if db is None:
        db = get_database()
    return UserService(
        user_repo=UserRepository(db["users"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.get("", response_model=PaginatedResponse[UserResponse])
async def list_users(
    request: Request,
    pagination: PaginationParams = Depends(),
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> PaginatedResponse[UserResponse]:
    service = _build_service()
    users, total = await service.list_users(
        skip=pagination.skip,
        limit=pagination.page_size,
    )
    return PaginatedResponse.create(
        items=users,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    request: Request,
    body: UserCreate,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> UserResponse:
    service = _build_service()
    return await service.create(
        data=body,
        created_by=current_user.sub,
        client_ip=_get_client_ip(request),
    )


@router.get("/{id}", response_model=UserResponse)
async def get_user(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> UserResponse:
    service = _build_service()
    return await service.get_by_id(id)


@router.put("/{id}", response_model=UserResponse)
async def update_user(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: UserUpdate,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> UserResponse:
    service = _build_service()
    return await service.update(
        id=id,
        data=body,
        updated_by=current_user.sub,
        client_ip=_get_client_ip(request),
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> None:
    service = _build_service()
    await service.deactivate(
        id=id,
        deactivated_by=current_user.sub,
        client_ip=_get_client_ip(request),
    )


@router.post("/{id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_user_password(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: UserResetPassword,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> None:
    service = _build_service()
    await service.reset_password(
        id=id,
        new_password=body.new_password,
        reset_by=current_user.sub,
        client_ip=_get_client_ip(request),
    )


@router.post("/{id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user_action(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> None:
    service = _build_service()
    await service.deactivate(
        id=id,
        deactivated_by=current_user.sub,
        client_ip=_get_client_ip(request),
    )


@router.post("/{id}/activate", response_model=UserResponse)
async def activate_user(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> UserResponse:
    service = _build_service()
    return await service.activate(
        id=id,
        activated_by=current_user.sub,
        client_ip=_get_client_ip(request),
    )

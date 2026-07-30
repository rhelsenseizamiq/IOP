import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.models.user import UserInToken
from app.repositories.cabinet_repository import CabinetRepository
from app.repositories.folder_repository import FolderRepository
from app.schemas.folder import FolderCreate, FolderResponse, FolderUpdate
from app.services.folder_service import FolderService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/folders", tags=["folders"])

_OBJECTID_PATTERN = "^[0-9a-f]{24}$"
_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator", "SuperAdmin")
_OPERATOR_PLUS = require_role("Operator", "Administrator", "SuperAdmin")


def _build_service() -> FolderService:
    db = get_database()
    return FolderService(
        folder_repo=FolderRepository(db["folders"]),
        cabinet_repo=CabinetRepository(db["cabinets"]),
    )


@router.get("", response_model=list[FolderResponse])
async def list_folders(
    cabinet_id: str,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> list[FolderResponse]:
    service = _build_service()
    return await service.list_folders(cabinet_id, current_user.sub, current_user.role.value)


@router.post("", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    body: FolderCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> FolderResponse:
    service = _build_service()
    return await service.create_folder(body, current_user.sub, current_user.role.value)


@router.patch("/{id}", response_model=FolderResponse)
async def update_folder(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    body: FolderUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> FolderResponse:
    service = _build_service()
    return await service.update_folder(id, body, current_user.sub, current_user.role.value)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> None:
    service = _build_service()
    await service.delete_folder(id, current_user.sub, current_user.role.value)

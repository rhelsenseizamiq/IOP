import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.models.folder import Folder
from app.repositories.cabinet_repository import CabinetRepository
from app.repositories.folder_repository import FolderRepository
from app.schemas.folder import FolderCreate, FolderResponse, FolderUpdate

logger = logging.getLogger(__name__)


def _to_response(folder: Folder) -> FolderResponse:
    return FolderResponse(
        id=folder.id,
        cabinet_id=folder.cabinet_id,
        parent_id=folder.parent_id,
        name=folder.name,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        created_by=folder.created_by,
        updated_by=folder.updated_by,
    )


class FolderService:
    def __init__(
        self,
        folder_repo: FolderRepository,
        cabinet_repo: CabinetRepository,
    ) -> None:
        self._folders = folder_repo
        self._cabinets = cabinet_repo

    async def _assert_cabinet_access(self, cabinet_id: str, username: str, role: str) -> None:
        cabinet = await self._cabinets.find_by_id(cabinet_id)
        if cabinet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
        if role not in ("Administrator", "SuperAdmin") and username not in cabinet.member_usernames:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    async def list_folders(self, cabinet_id: str, username: str, role: str) -> list[FolderResponse]:
        await self._assert_cabinet_access(cabinet_id, username, role)
        folders = await self._folders.find_by_cabinet(cabinet_id)
        return [_to_response(f) for f in folders]

    async def create_folder(
        self, data: FolderCreate, created_by: str, role: str
    ) -> FolderResponse:
        await self._assert_cabinet_access(data.cabinet_id, created_by, role)
        if data.parent_id is not None:
            parent = await self._folders.find_by_id(data.parent_id)
            if parent is None or parent.cabinet_id != data.cabinet_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent folder not found")
        existing = await self._folders.find_by_name_in_parent(data.cabinet_id, data.parent_id, data.name)
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Folder '{data.name}' already exists here")
        now = datetime.now(timezone.utc)
        doc = {
            "cabinet_id": data.cabinet_id,
            "parent_id": data.parent_id,
            "name": data.name,
            "created_at": now,
            "updated_at": now,
            "created_by": created_by,
            "updated_by": created_by,
        }
        folder = await self._folders.create(doc)
        return _to_response(folder)

    async def update_folder(
        self, folder_id: str, data: FolderUpdate, updated_by: str, role: str
    ) -> FolderResponse:
        folder = await self._folders.find_by_id(folder_id)
        if folder is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
        await self._assert_cabinet_access(folder.cabinet_id, updated_by, role)
        if data.name != folder.name:
            existing = await self._folders.find_by_name_in_parent(folder.cabinet_id, folder.parent_id, data.name)
            if existing is not None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Folder '{data.name}' already exists here")
        updated = await self._folders.update(folder_id, {"name": data.name, "updated_by": updated_by})
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
        return _to_response(updated)

    async def delete_folder(self, folder_id: str, deleted_by: str, role: str) -> None:
        folder = await self._folders.find_by_id(folder_id)
        if folder is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
        await self._assert_cabinet_access(folder.cabinet_id, deleted_by, role)
        # Recursively collect all child folder IDs
        all_ids = await self._collect_subtree(folder_id)
        for fid in all_ids:
            await self._folders.delete(fid)

    async def _collect_subtree(self, folder_id: str) -> list[str]:
        """Returns folder_id plus all descendant IDs."""
        result = [folder_id]
        children = await self._folders.find_by_cabinet("")
        # We do a full traverse using the cabinet
        folder = await self._folders.find_by_id(folder_id)
        if folder is None:
            return result
        all_in_cabinet = await self._folders.find_by_cabinet(folder.cabinet_id)
        id_to_children: dict[str, list[str]] = {}
        for f in all_in_cabinet:
            pid = f.parent_id or "__root__"
            id_to_children.setdefault(pid, []).append(f.id)
        queue = [folder_id]
        while queue:
            current = queue.pop()
            for child_id in id_to_children.get(current, []):
                result.append(child_id)
                queue.append(child_id)
        return result

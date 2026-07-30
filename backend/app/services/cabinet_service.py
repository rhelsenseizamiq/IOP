import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.models.audit_log import AuditAction, ResourceType
from app.models.cabinet import Cabinet
from app.models.user import Role
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.cabinet_repository import CabinetRepository
from app.repositories.password_repository import PasswordRepository
from app.repositories.user_repository import UserRepository
from app.schemas.cabinet import CabinetCreate, CabinetResponse, CabinetUpdate

logger = logging.getLogger(__name__)

_ADMIN_ROLES = {Role.ADMINISTRATOR.value, Role.SUPER_ADMIN.value}
_SUPER_ADMIN_ROLES = {Role.SUPER_ADMIN.value}


def _to_response(cabinet: Cabinet, entry_count: int = 0) -> CabinetResponse:
    return CabinetResponse(
        id=cabinet.id,
        name=cabinet.name,
        description=cabinet.description,
        member_usernames=cabinet.member_usernames,
        entry_count=entry_count,
        created_at=cabinet.created_at,
        updated_at=cabinet.updated_at,
        created_by=cabinet.created_by,
        updated_by=cabinet.updated_by,
    )


def _assert_admin(role: str) -> None:
    if role not in _ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator or SuperAdmin role required",
        )


def _assert_super_admin(role: str) -> None:
    if role not in _SUPER_ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only SuperAdmin can perform this action",
        )


def _assert_can_manage_members(role: str, cabinet, actor: str) -> None:
    """SuperAdmin can manage any cabinet; Administrator only their own."""
    if role in _SUPER_ADMIN_ROLES:
        return
    if role == Role.ADMINISTRATOR.value:
        if cabinet.created_by != actor:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Administrators can only manage members of cabinets they created",
            )
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Administrator or SuperAdmin role required",
    )


class CabinetService:
    def __init__(
        self,
        cabinet_repo: CabinetRepository,
        password_repo: PasswordRepository,
        user_repo: UserRepository,
        audit_repo: AuditLogRepository,
    ) -> None:
        self._cabinets = cabinet_repo
        self._passwords = password_repo
        self._users = user_repo
        self._audit = audit_repo

    async def _entry_count(self, cabinet_id: str) -> int:
        return await self._passwords.count({"cabinet_id": cabinet_id})

    async def list_cabinets(self, username: str, role: str) -> list[CabinetResponse]:
        if role in _ADMIN_ROLES:
            cabinets, _ = await self._cabinets.find_all({})
        else:
            cabinets = await self._cabinets.find_by_member(username)
        result = []
        for cab in cabinets:
            count = await self._entry_count(cab.id)
            result.append(_to_response(cab, count))
        return result

    async def get_cabinet(self, cabinet_id: str, username: str, role: str) -> CabinetResponse:
        cabinet = await self._cabinets.find_by_id(cabinet_id)
        if cabinet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
        if role not in _ADMIN_ROLES and username not in cabinet.member_usernames:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        count = await self._entry_count(cabinet_id)
        return _to_response(cabinet, count)

    async def create_cabinet(self, data: CabinetCreate, created_by: str, role: str, client_ip: str) -> CabinetResponse:
        _assert_admin(role)
        existing = await self._cabinets.find_by_name(data.name)
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cabinet name '{data.name}' is already taken")
        now = datetime.now(timezone.utc)
        doc = {
            "name": data.name,
            "description": data.description,
            "member_usernames": data.member_usernames,
            "created_at": now,
            "updated_at": now,
            "created_by": created_by,
            "updated_by": created_by,
        }
        cabinet = await self._cabinets.create(doc)
        await self._audit.log(
            action=AuditAction.CREATE, resource_type=ResourceType.CABINET,
            username=created_by, user_role=role, client_ip=client_ip,
            resource_id=cabinet.id, after={"name": cabinet.name, "members": cabinet.member_usernames},
            detail=f"Created cabinet '{cabinet.name}'",
        )
        return _to_response(cabinet)

    async def update_cabinet(self, cabinet_id: str, data: CabinetUpdate, updated_by: str, role: str, client_ip: str) -> CabinetResponse:
        _assert_admin(role)
        cabinet = await self._cabinets.find_by_id(cabinet_id)
        if cabinet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
        fields = data.model_dump(exclude_none=True)
        if not fields:
            count = await self._entry_count(cabinet_id)
            return _to_response(cabinet, count)
        if "name" in fields and fields["name"] != cabinet.name:
            conflict = await self._cabinets.find_by_name(fields["name"])
            if conflict is not None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cabinet name '{fields['name']}' is already taken")
        before_snap = {"name": cabinet.name, "description": cabinet.description}
        updated = await self._cabinets.update(cabinet_id, {**fields, "updated_by": updated_by})
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
        await self._audit.log(
            action=AuditAction.UPDATE, resource_type=ResourceType.CABINET,
            username=updated_by, user_role=role, client_ip=client_ip,
            resource_id=cabinet_id, before=before_snap,
            after={"name": updated.name, "description": updated.description},
            detail=f"Updated cabinet '{updated.name}'",
        )
        count = await self._entry_count(cabinet_id)
        return _to_response(updated, count)

    async def delete_cabinet(self, cabinet_id: str, deleted_by: str, role: str, client_ip: str) -> None:
        _assert_super_admin(role)
        cabinet = await self._cabinets.find_by_id(cabinet_id)
        if cabinet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
        await self._passwords.delete_by_cabinet(cabinet_id)
        deleted = await self._cabinets.delete(cabinet_id)
        if not deleted:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete cabinet")
        await self._audit.log(
            action=AuditAction.DELETE, resource_type=ResourceType.CABINET,
            username=deleted_by, user_role=role, client_ip=client_ip,
            resource_id=cabinet_id, before={"name": cabinet.name},
            detail=f"Deleted cabinet '{cabinet.name}' and all its entries",
        )

    async def add_members(self, cabinet_id: str, usernames: list[str], updated_by: str, role: str, client_ip: str) -> CabinetResponse:
        cabinet = await self._cabinets.find_by_id(cabinet_id)
        if cabinet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
        _assert_can_manage_members(role, cabinet, updated_by)
        for username in usernames:
            existing_user = await self._users.find_by_username(username)
            if existing_user is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User '{username}' not found")
        updated = cabinet
        for username in usernames:
            updated = await self._cabinets.add_member(cabinet_id, username)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
        await self._audit.log(
            action=AuditAction.UPDATE, resource_type=ResourceType.CABINET,
            username=updated_by, user_role=role, client_ip=client_ip,
            resource_id=cabinet_id, detail=f"Added members {usernames} to cabinet '{cabinet.name}'",
        )
        count = await self._entry_count(cabinet_id)
        return _to_response(updated, count)

    async def remove_member(self, cabinet_id: str, username: str, updated_by: str, role: str, client_ip: str) -> CabinetResponse:
        cabinet = await self._cabinets.find_by_id(cabinet_id)
        if cabinet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
        _assert_can_manage_members(role, cabinet, updated_by)
        updated = await self._cabinets.remove_member(cabinet_id, username)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
        await self._audit.log(
            action=AuditAction.UPDATE, resource_type=ResourceType.CABINET,
            username=updated_by, user_role=role, client_ip=client_ip,
            resource_id=cabinet_id, detail=f"Removed member '{username}' from cabinet '{cabinet.name}'",
        )
        count = await self._entry_count(cabinet_id)
        return _to_response(updated, count)

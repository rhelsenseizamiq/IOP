import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.config import get_settings
from app.core.vault import decrypt_password, encrypt_password
from app.models.audit_log import AuditAction, ResourceType
from app.models.user import Role
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.cabinet_repository import CabinetRepository
from app.repositories.password_repository import PasswordRepository
from app.schemas.password_entry import (
    PasswordEntryCreate,
    PasswordEntryDetailResponse,
    PasswordEntryResponse,
    PasswordEntryUpdate,
    RevealResponse,
)

logger = logging.getLogger(__name__)

_OPERATOR_ABOVE = {Role.OPERATOR.value, Role.ADMINISTRATOR.value, Role.SUPER_ADMIN.value}


def _to_response(entry) -> PasswordEntryResponse:
    return PasswordEntryResponse(
        id=entry.id,
        cabinet_id=entry.cabinet_id,
        folder_id=entry.folder_id,
        title=entry.title,
        username=entry.username,
        url=entry.url,
        tags=entry.tags,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        created_by=entry.created_by,
        updated_by=entry.updated_by,
    )


def _to_detail_response(entry) -> PasswordEntryDetailResponse:
    return PasswordEntryDetailResponse(
        id=entry.id,
        cabinet_id=entry.cabinet_id,
        folder_id=entry.folder_id,
        title=entry.title,
        username=entry.username,
        url=entry.url,
        notes=entry.notes,
        tags=entry.tags,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        created_by=entry.created_by,
        updated_by=entry.updated_by,
    )


async def _assert_member(cabinet_repo, cabinet_id, username, role):
    cabinet = await cabinet_repo.find_by_id(cabinet_id)
    if cabinet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabinet not found")
    if username not in cabinet.member_usernames:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a member of this cabinet")


def _require_vault_key() -> str:
    settings = get_settings()
    if not settings.VAULT_MASTER_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Vault is not configured. Set VAULT_MASTER_KEY in environment.",
        )
    return settings.VAULT_MASTER_KEY


class PasswordService:
    def __init__(self, password_repo, cabinet_repo, audit_repo) -> None:
        self._passwords = password_repo
        self._cabinets = cabinet_repo
        self._audit = audit_repo

    async def list_entries(self, cabinet_id, username, role, skip=0, limit=50, folder_id=None):
        await _assert_member(self._cabinets, cabinet_id, username, role)
        entries, total = await self._passwords.find_by_cabinet(
            cabinet_id, skip=skip, limit=limit, folder_id=folder_id
        )
        return [_to_response(e) for e in entries], total

    async def get_entry(self, entry_id, username, role):
        entry = await self._passwords.find_by_id(entry_id)
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
        await _assert_member(self._cabinets, entry.cabinet_id, username, role)
        return _to_detail_response(entry)

    async def reveal_entry(self, entry_id, username, role, client_ip):
        master_key = _require_vault_key()
        entry = await self._passwords.find_by_id(entry_id)
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
        await _assert_member(self._cabinets, entry.cabinet_id, username, role)
        try:
            plaintext = decrypt_password(master_key, entry.cabinet_id, entry.ciphertext, entry.iv)
        except Exception as exc:
            logger.error("Decryption failed for entry %s: %s", entry_id, exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to decrypt password. The vault key may have changed.",
            ) from exc
        await self._audit.log(
            action=AuditAction.REVEAL, resource_type=ResourceType.PASSWORD_ENTRY,
            username=username, user_role=role, client_ip=client_ip, resource_id=entry_id,
            detail=f"Revealed password for entry '{entry.title}' in cabinet '{entry.cabinet_id}'",
        )
        return RevealResponse(password=plaintext), {"Cache-Control": "no-store"}

    async def create_entry(self, data, created_by, role, client_ip):
        if role not in _OPERATOR_ABOVE:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator or above role required")
        master_key = _require_vault_key()
        await _assert_member(self._cabinets, data.cabinet_id, created_by, role)
        ciphertext, iv = encrypt_password(master_key, data.cabinet_id, data.password)
        now = datetime.now(timezone.utc)
        doc = {
            "cabinet_id": data.cabinet_id,
            "folder_id": data.folder_id,
            "title": data.title,
            "username": data.username,
            "ciphertext": ciphertext,
            "iv": iv,
            "url": data.url,
            "notes": data.notes,
            "tags": data.tags,
            "created_at": now,
            "updated_at": now,
            "created_by": created_by,
            "updated_by": created_by,
        }
        entry = await self._passwords.create(doc)
        await self._audit.log(
            action=AuditAction.CREATE, resource_type=ResourceType.PASSWORD_ENTRY,
            username=created_by, user_role=role, client_ip=client_ip, resource_id=entry.id,
            after={"title": entry.title, "cabinet_id": entry.cabinet_id, "folder_id": entry.folder_id},
            detail=f"Created password entry '{entry.title}'",
        )
        return _to_response(entry)

    async def update_entry(self, entry_id, data, updated_by, role, client_ip):
        if role not in _OPERATOR_ABOVE:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator or above role required")
        entry = await self._passwords.find_by_id(entry_id)
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
        await _assert_member(self._cabinets, entry.cabinet_id, updated_by, role)
        fields = data.model_dump(exclude_unset=True)
        if "password" in fields:
            master_key = _require_vault_key()
            ciphertext, iv = encrypt_password(master_key, entry.cabinet_id, fields.pop("password"))
            fields["ciphertext"] = ciphertext
            fields["iv"] = iv
        if not fields:
            return _to_response(entry)
        fields["updated_by"] = updated_by
        updated = await self._passwords.update(entry_id, fields)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
        await self._audit.log(
            action=AuditAction.UPDATE, resource_type=ResourceType.PASSWORD_ENTRY,
            username=updated_by, user_role=role, client_ip=client_ip, resource_id=entry_id,
            detail=f"Updated password entry '{entry.title}'",
        )
        return _to_response(updated)

    async def move_entry(self, entry_id, folder_id, updated_by, role, client_ip):
        if role not in _OPERATOR_ABOVE:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator or above role required")
        entry = await self._passwords.find_by_id(entry_id)
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
        await _assert_member(self._cabinets, entry.cabinet_id, updated_by, role)
        updated = await self._passwords.update(entry_id, {"folder_id": folder_id, "updated_by": updated_by})
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
        await self._audit.log(
            action=AuditAction.UPDATE, resource_type=ResourceType.PASSWORD_ENTRY,
            username=updated_by, user_role=role, client_ip=client_ip, resource_id=entry_id,
            detail=f"Moved password entry '{entry.title}' to folder '{folder_id}'",
        )
        return _to_response(updated)

    async def delete_entry(self, entry_id, deleted_by, role, client_ip):
        if role not in _OPERATOR_ABOVE:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator or above role required")
        entry = await self._passwords.find_by_id(entry_id)
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
        await _assert_member(self._cabinets, entry.cabinet_id, deleted_by, role)
        deleted = await self._passwords.delete(entry_id)
        if not deleted:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete entry")
        await self._audit.log(
            action=AuditAction.DELETE, resource_type=ResourceType.PASSWORD_ENTRY,
            username=deleted_by, user_role=role, client_ip=client_ip, resource_id=entry_id,
            before={"title": entry.title, "cabinet_id": entry.cabinet_id},
            detail=f"Deleted password entry '{entry.title}'",
        )

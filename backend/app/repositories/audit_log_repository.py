import logging
from typing import Any, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorCollection

from app.models.audit_log import AuditLog, AuditAction, ResourceType
from app.repositories.base import BaseRepository

logger = logging.getLogger(__name__)

_SENSITIVE_KEYS = frozenset({
    "password_hash", "password", "ciphertext", "iv",
    # File sharing (see app/services/file_service.py / share_service.py) —
    # encryption keys and raw share tokens must never land in an audit
    # record's before/after payload.
    "wrapped_dek", "dek_iv", "file_iv", "token",
})


def _strip_sensitive(data: Optional[dict]) -> Optional[dict]:
    """Remove sensitive keys from a snapshot dict before persisting to audit log."""
    if data is None:
        return None
    return {k: v for k, v in data.items() if k not in _SENSITIVE_KEYS}


class AuditLogRepository(BaseRepository[AuditLog]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, AuditLog)

    # Intentionally omit update() and delete() — audit logs are immutable.
    async def update(self, *args, **kwargs):  # type: ignore[override]
        raise NotImplementedError("Audit logs are immutable and cannot be updated")

    async def delete(self, *args, **kwargs):  # type: ignore[override]
        raise NotImplementedError("Audit logs are immutable and cannot be deleted")

    async def log(
        self,
        action: AuditAction,
        resource_type: ResourceType,
        username: str,
        user_role: str,
        client_ip: str,
        resource_id: Optional[str] = None,
        before: Optional[dict[str, Any]] = None,
        after: Optional[dict[str, Any]] = None,
        detail: Optional[str] = None,
    ) -> Optional[AuditLog]:
        """Creates an immutable audit log entry, stripping any sensitive keys from before/after."""
        doc = {
            "action": action.value,
            "resource_type": resource_type.value,
            "resource_id": resource_id,
            "username": username,
            "user_role": user_role,
            "client_ip": client_ip,
            "timestamp": datetime.now(timezone.utc),
            "before": _strip_sensitive(before),
            "after": _strip_sensitive(after),
            "detail": detail,
        }
        try:
            return await self.create(doc)
        except Exception as exc:
            # Never let an audit log failure crash the main operation
            logger.error("Failed to write audit log: %s", exc, exc_info=True)
            return None

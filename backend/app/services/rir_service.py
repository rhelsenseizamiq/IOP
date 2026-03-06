import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.models.audit_log import AuditAction, ResourceType
from app.models.rir import RIR
from app.repositories.aggregate_repository import AggregateRepository
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.rir_repository import RIRRepository
from app.schemas.rir import RIRCreate, RIRResponse, RIRUpdate

logger = logging.getLogger(__name__)


def _to_response(rir: RIR, aggregate_count: int = 0) -> RIRResponse:
    return RIRResponse(
        id=rir.id,
        name=rir.name,
        slug=rir.slug,
        description=rir.description,
        is_private=rir.is_private,
        aggregate_count=aggregate_count,
        created_at=rir.created_at,
        updated_at=rir.updated_at,
        created_by=rir.created_by,
        updated_by=rir.updated_by,
    )


class RIRService:
    def __init__(
        self,
        rir_repo: RIRRepository,
        aggregate_repo: AggregateRepository,
        audit_repo: AuditLogRepository,
    ) -> None:
        self._rirs = rir_repo
        self._aggregates = aggregate_repo
        self._audit = audit_repo

    async def create(
        self,
        data: RIRCreate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> RIRResponse:
        if await self._rirs.find_by_name(data.name):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"RIR with name '{data.name}' already exists",
            )
        if await self._rirs.find_by_slug(data.slug):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"RIR with slug '{data.slug}' already exists",
            )

        now = datetime.now(timezone.utc)
        doc = {
            "name": data.name,
            "slug": data.slug,
            "description": data.description,
            "is_private": data.is_private,
            "created_at": now,
            "updated_at": now,
            "created_by": username,
            "updated_by": username,
        }
        rir = await self._rirs.create(doc)
        await self._audit.log(
            action=AuditAction.CREATE,
            resource_type=ResourceType.RIR,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=rir.id,
            after={"name": rir.name, "slug": rir.slug},
            detail=f"Created RIR {data.name}",
        )
        return _to_response(rir)

    async def get_by_id(self, id: str) -> RIRResponse:
        rir = await self._rirs.find_by_id(id)
        if rir is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RIR not found")
        count = await self._aggregates.count_by_rir(id)
        return _to_response(rir, aggregate_count=count)

    async def list_rirs(self, skip: int = 0, limit: int = 50) -> tuple[list[RIRResponse], int]:
        rirs, total = await self._rirs.find_all({}, skip=skip, limit=limit)
        result = []
        for rir in rirs:
            count = await self._aggregates.count_by_rir(rir.id)
            result.append(_to_response(rir, aggregate_count=count))
        return result, total

    async def update(
        self,
        id: str,
        data: RIRUpdate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> RIRResponse:
        existing = await self._rirs.find_by_id(id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RIR not found")

        update_fields = data.model_dump(exclude_none=True)
        update_fields["updated_by"] = username

        updated = await self._rirs.update(id, update_fields)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RIR not found")

        await self._audit.log(
            action=AuditAction.UPDATE,
            resource_type=ResourceType.RIR,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            detail=f"Updated RIR {existing.name}",
        )
        count = await self._aggregates.count_by_rir(id)
        return _to_response(updated, aggregate_count=count)

    async def delete(
        self,
        id: str,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> None:
        existing = await self._rirs.find_by_id(id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RIR not found")

        agg_count = await self._aggregates.count_by_rir(id)
        if agg_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot delete RIR '{existing.name}' — {agg_count} aggregate(s) are assigned to it",
            )

        deleted = await self._rirs.delete(id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete RIR",
            )

        await self._audit.log(
            action=AuditAction.DELETE,
            resource_type=ResourceType.RIR,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            detail=f"Deleted RIR {existing.name}",
        )

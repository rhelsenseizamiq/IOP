import ipaddress
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status

from app.models.aggregate import Aggregate
from app.models.audit_log import AuditAction, ResourceType
from app.repositories.aggregate_repository import AggregateRepository
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.rir_repository import RIRRepository
from app.repositories.subnet_repository import SubnetRepository
from app.schemas.aggregate import AggregateCreate, AggregateResponse, AggregateUpdate

logger = logging.getLogger(__name__)


def _to_response(
    agg: Aggregate, rir_name: str = "", contained_prefix_count: int = 0
) -> AggregateResponse:
    return AggregateResponse(
        id=agg.id,
        prefix=agg.prefix,
        prefix_len=agg.prefix_len,
        rir_id=agg.rir_id,
        rir_name=rir_name,
        description=agg.description,
        date_added=agg.date_added,
        contained_prefix_count=contained_prefix_count,
        created_at=agg.created_at,
        updated_at=agg.updated_at,
        created_by=agg.created_by,
        updated_by=agg.updated_by,
    )


def _count_contained(agg: Aggregate, all_subnets: list) -> int:
    """Count root subnets (parent_id=None) whose CIDR falls within the aggregate."""
    try:
        agg_net = ipaddress.ip_network(agg.prefix, strict=False)
    except ValueError:
        return 0
    count = 0
    for subnet in all_subnets:
        if subnet.parent_id is not None:
            continue
        try:
            s_net = ipaddress.ip_network(subnet.cidr, strict=False)
            if s_net.subnet_of(agg_net):
                count += 1
        except ValueError:
            continue
    return count


class AggregateService:
    def __init__(
        self,
        aggregate_repo: AggregateRepository,
        rir_repo: RIRRepository,
        subnet_repo: SubnetRepository,
        audit_repo: AuditLogRepository,
    ) -> None:
        self._aggregates = aggregate_repo
        self._rirs = rir_repo
        self._subnets = subnet_repo
        self._audit = audit_repo

    async def _rir_name(self, rir_id: str) -> str:
        rir = await self._rirs.find_by_id(rir_id)
        return rir.name if rir else ""

    async def create(
        self,
        data: AggregateCreate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> AggregateResponse:
        # Validate RIR
        rir = await self._rirs.find_by_id(data.rir_id)
        if rir is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"RIR '{data.rir_id}' not found",
            )

        network = ipaddress.ip_network(data.prefix, strict=False)
        prefix_len = network.prefixlen

        # No duplicate prefix
        if await self._aggregates.find_by_prefix(data.prefix):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Aggregate '{data.prefix}' already exists",
            )

        # No overlap with existing aggregates
        all_aggs, _ = await self._aggregates.find_all({}, skip=0, limit=10_000)
        for existing in all_aggs:
            try:
                ex_net = ipaddress.ip_network(existing.prefix, strict=False)
                if network.overlaps(ex_net):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Aggregate '{data.prefix}' overlaps with existing aggregate '{existing.prefix}'",
                    )
            except ValueError:
                continue

        now = datetime.now(timezone.utc)
        doc = {
            "prefix": data.prefix,
            "prefix_len": prefix_len,
            "rir_id": data.rir_id,
            "description": data.description,
            "date_added": data.date_added,
            "created_at": now,
            "updated_at": now,
            "created_by": username,
            "updated_by": username,
        }

        agg = await self._aggregates.create(doc)
        await self._audit.log(
            action=AuditAction.CREATE,
            resource_type=ResourceType.AGGREGATE,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=agg.id,
            after={"prefix": agg.prefix, "rir_id": agg.rir_id},
            detail=f"Created aggregate {data.prefix}",
        )
        return _to_response(agg, rir_name=rir.name)

    async def get_by_id(self, id: str) -> AggregateResponse:
        agg = await self._aggregates.find_by_id(id)
        if agg is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Aggregate not found"
            )
        all_subnets, _ = await self._subnets.find_all({}, skip=0, limit=10_000)
        count = _count_contained(agg, all_subnets)
        rir_name = await self._rir_name(agg.rir_id)
        return _to_response(agg, rir_name=rir_name, contained_prefix_count=count)

    async def list_aggregates(
        self,
        filter_: dict,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[AggregateResponse], int]:
        aggs, total = await self._aggregates.find_all(filter_, skip=skip, limit=limit)
        if not aggs:
            return [], total

        all_subnets, _ = await self._subnets.find_all({}, skip=0, limit=10_000)

        result = []
        for agg in aggs:
            count = _count_contained(agg, all_subnets)
            rir_name = await self._rir_name(agg.rir_id)
            result.append(_to_response(agg, rir_name=rir_name, contained_prefix_count=count))
        return result, total

    async def update(
        self,
        id: str,
        data: AggregateUpdate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> AggregateResponse:
        existing = await self._aggregates.find_by_id(id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Aggregate not found"
            )

        if data.rir_id:
            if not await self._rirs.find_by_id(data.rir_id):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"RIR '{data.rir_id}' not found",
                )

        update_fields = data.model_dump(exclude_none=True)
        update_fields["updated_by"] = username

        updated = await self._aggregates.update(id, update_fields)
        if updated is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Aggregate not found"
            )

        await self._audit.log(
            action=AuditAction.UPDATE,
            resource_type=ResourceType.AGGREGATE,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            detail=f"Updated aggregate {existing.prefix}",
        )
        rir_name = await self._rir_name(updated.rir_id)
        return _to_response(updated, rir_name=rir_name)

    async def delete(
        self,
        id: str,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> None:
        existing = await self._aggregates.find_by_id(id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Aggregate not found"
            )

        deleted = await self._aggregates.delete(id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete aggregate",
            )

        await self._audit.log(
            action=AuditAction.DELETE,
            resource_type=ResourceType.AGGREGATE,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            detail=f"Deleted aggregate {existing.prefix}",
        )

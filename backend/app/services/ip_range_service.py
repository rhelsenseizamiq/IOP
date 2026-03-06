import ipaddress
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status

from app.models.audit_log import AuditAction, ResourceType
from app.models.ip_range import IPRange
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.ip_range_repository import IPRangeRepository
from app.repositories.subnet_repository import SubnetRepository
from app.schemas.ip_range import IPRangeCreate, IPRangeResponse, IPRangeUpdate

logger = logging.getLogger(__name__)


def _ip_to_int(ip: str) -> int:
    return int(ipaddress.ip_address(ip))


def _to_response(r: IPRange) -> IPRangeResponse:
    return IPRangeResponse(
        id=r.id,
        subnet_id=r.subnet_id,
        vrf_id=r.vrf_id,
        name=r.name,
        description=r.description,
        start_address=r.start_address,
        end_address=r.end_address,
        size=r.size,
        status=r.status,
        created_at=r.created_at,
        updated_at=r.updated_at,
        created_by=r.created_by,
        updated_by=r.updated_by,
    )


class IPRangeService:
    def __init__(
        self,
        ip_range_repo: IPRangeRepository,
        subnet_repo: SubnetRepository,
        audit_repo: AuditLogRepository,
    ) -> None:
        self._ranges = ip_range_repo
        self._subnets = subnet_repo
        self._audit = audit_repo

    async def _validate_range_in_subnet(
        self, start: str, end: str, subnet_id: str
    ) -> None:
        subnet = await self._subnets.find_by_id(subnet_id)
        if subnet is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subnet '{subnet_id}' not found",
            )
        network = ipaddress.ip_network(subnet.cidr, strict=False)
        for addr_str, label in [(start, "start_address"), (end, "end_address")]:
            addr = ipaddress.ip_address(addr_str)
            if addr not in network:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"{label} {addr_str} is not within subnet {subnet.cidr}",
                )

    async def create(
        self,
        data: IPRangeCreate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> IPRangeResponse:
        await self._validate_range_in_subnet(data.start_address, data.end_address, data.subnet_id)

        start_int = _ip_to_int(data.start_address)
        end_int = _ip_to_int(data.end_address)

        # Check for overlap with existing ranges
        overlap = await self._ranges.find_overlapping(data.subnet_id, start_int, end_int)
        if overlap is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Range {data.start_address}–{data.end_address} overlaps with existing range '{overlap.name}'",
            )

        # Inherit vrf_id from subnet
        subnet = await self._subnets.find_by_id(data.subnet_id)
        vrf_id = subnet.vrf_id if subnet else None

        now = datetime.now(timezone.utc)
        doc = {
            "subnet_id": data.subnet_id,
            "vrf_id": vrf_id,
            "name": data.name,
            "description": data.description,
            "start_address": data.start_address,
            "end_address": data.end_address,
            "start_int": start_int,
            "end_int": end_int,
            "size": end_int - start_int + 1,
            "status": data.status,
            "created_at": now,
            "updated_at": now,
            "created_by": username,
            "updated_by": username,
        }

        ip_range = await self._ranges.create(doc)
        await self._audit.log(
            action=AuditAction.CREATE,
            resource_type=ResourceType.IP_RANGE,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=ip_range.id,
            after={"name": ip_range.name, "start": ip_range.start_address, "end": ip_range.end_address},
            detail=f"Created IP range {data.name}",
        )
        return _to_response(ip_range)

    async def get_by_id(self, id: str) -> IPRangeResponse:
        r = await self._ranges.find_by_id(id)
        if r is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="IP range not found"
            )
        return _to_response(r)

    async def list_by_subnet(
        self, subnet_id: str, skip: int = 0, limit: int = 50
    ) -> tuple[list[IPRangeResponse], int]:
        ranges, total = await self._ranges.find_by_subnet(subnet_id, skip=skip, limit=limit)
        return [_to_response(r) for r in ranges], total

    async def update(
        self,
        id: str,
        data: IPRangeUpdate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> IPRangeResponse:
        existing = await self._ranges.find_by_id(id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="IP range not found"
            )

        new_start = data.start_address or existing.start_address
        new_end = data.end_address or existing.end_address

        if data.start_address or data.end_address:
            await self._validate_range_in_subnet(new_start, new_end, existing.subnet_id)
            start_int = _ip_to_int(new_start)
            end_int = _ip_to_int(new_end)
            if start_int > end_int:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="start_address must be less than or equal to end_address",
                )
            overlap = await self._ranges.find_overlapping(
                existing.subnet_id, start_int, end_int, exclude_id=id
            )
            if overlap is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Range overlaps with existing range '{overlap.name}'",
                )
        else:
            start_int = existing.start_int
            end_int = existing.end_int

        update_fields = data.model_dump(exclude_none=True)
        if data.start_address or data.end_address:
            update_fields["start_int"] = start_int
            update_fields["end_int"] = end_int
            update_fields["size"] = end_int - start_int + 1
        update_fields["updated_by"] = username

        updated = await self._ranges.update(id, update_fields)
        if updated is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="IP range not found"
            )

        await self._audit.log(
            action=AuditAction.UPDATE,
            resource_type=ResourceType.IP_RANGE,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            detail=f"Updated IP range {existing.name}",
        )
        return _to_response(updated)

    async def delete(
        self,
        id: str,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> None:
        existing = await self._ranges.find_by_id(id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="IP range not found"
            )

        deleted = await self._ranges.delete(id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete IP range",
            )

        await self._audit.log(
            action=AuditAction.DELETE,
            resource_type=ResourceType.IP_RANGE,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            detail=f"Deleted IP range {existing.name}",
        )

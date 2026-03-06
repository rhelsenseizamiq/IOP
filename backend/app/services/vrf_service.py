import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.models.audit_log import AuditAction, ResourceType
from app.models.vrf import VRF
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.vrf_repository import VRFRepository
from app.schemas.vrf import VRFCreate, VRFResponse, VRFUpdate

logger = logging.getLogger(__name__)


def _to_response(vrf: VRF, subnet_count: int = 0) -> VRFResponse:
    return VRFResponse(
        id=vrf.id,
        name=vrf.name,
        rd=vrf.rd,
        description=vrf.description,
        enforce_unique=vrf.enforce_unique,
        subnet_count=subnet_count,
        created_at=vrf.created_at,
        updated_at=vrf.updated_at,
        created_by=vrf.created_by,
        updated_by=vrf.updated_by,
    )


class VRFService:
    def __init__(
        self,
        vrf_repo: VRFRepository,
        subnet_repo: SubnetRepository,
        audit_repo: AuditLogRepository,
    ) -> None:
        self._vrfs = vrf_repo
        self._subnets = subnet_repo
        self._audit = audit_repo

    async def create(
        self,
        data: VRFCreate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> VRFResponse:
        existing = await self._vrfs.find_by_name(data.name)
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"VRF with name '{data.name}' already exists",
            )

        now = datetime.now(timezone.utc)
        doc = {
            "name": data.name,
            "rd": data.rd,
            "description": data.description,
            "enforce_unique": data.enforce_unique,
            "created_at": now,
            "updated_at": now,
            "created_by": username,
            "updated_by": username,
        }

        vrf = await self._vrfs.create(doc)
        await self._audit.log(
            action=AuditAction.CREATE,
            resource_type=ResourceType.VRF,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=vrf.id,
            after={"name": vrf.name, "rd": vrf.rd},
            detail=f"Created VRF {data.name}",
        )
        return _to_response(vrf)

    async def get_by_id(self, id: str) -> VRFResponse:
        vrf = await self._vrfs.find_by_id(id)
        if vrf is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VRF not found")
        count = await self._subnets.count_by_vrf(id)
        return _to_response(vrf, subnet_count=count)

    async def list_vrfs(
        self, skip: int = 0, limit: int = 50
    ) -> tuple[list[VRFResponse], int]:
        vrfs, total = await self._vrfs.find_all({}, skip=skip, limit=limit)
        result = []
        for vrf in vrfs:
            count = await self._subnets.count_by_vrf(vrf.id)
            result.append(_to_response(vrf, subnet_count=count))
        return result, total

    async def update(
        self,
        id: str,
        data: VRFUpdate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> VRFResponse:
        existing = await self._vrfs.find_by_id(id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VRF not found")

        if data.name and data.name != existing.name:
            dup = await self._vrfs.find_by_name(data.name)
            if dup is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"VRF with name '{data.name}' already exists",
                )

        update_fields = data.model_dump(exclude_none=True)
        update_fields["updated_by"] = username

        if not update_fields:
            count = await self._subnets.count_by_vrf(id)
            return _to_response(existing, subnet_count=count)

        updated = await self._vrfs.update(id, update_fields)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VRF not found")

        await self._audit.log(
            action=AuditAction.UPDATE,
            resource_type=ResourceType.VRF,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            detail=f"Updated VRF {existing.name}",
        )
        count = await self._subnets.count_by_vrf(id)
        return _to_response(updated, subnet_count=count)

    async def delete(
        self,
        id: str,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> None:
        existing = await self._vrfs.find_by_id(id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VRF not found")

        subnet_count = await self._subnets.count_by_vrf(id)
        if subnet_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot delete VRF '{existing.name}' — {subnet_count} subnet(s) are assigned to it",
            )

        deleted = await self._vrfs.delete(id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete VRF",
            )

        await self._audit.log(
            action=AuditAction.DELETE,
            resource_type=ResourceType.VRF,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            detail=f"Deleted VRF {existing.name}",
        )

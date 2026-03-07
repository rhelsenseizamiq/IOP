import ipaddress
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status

from app.models.audit_log import AuditAction, ResourceType
from app.models.ip_record import IPStatus, Environment
from app.models.subnet import Subnet
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.ip_record_repository import IPRecordRepository
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.vrf_repository import VRFRepository
from app.schemas.subnet import (
    SubnetCreate,
    SubnetDetailResponse,
    SubnetResponse,
    SubnetTreeNode,
    SubnetUpdate,
)

logger = logging.getLogger(__name__)


def _to_response(subnet: Subnet) -> SubnetResponse:
    return SubnetResponse(
        id=subnet.id,
        cidr=subnet.cidr,
        name=subnet.name,
        description=subnet.description,
        gateway=subnet.gateway,
        vlan_id=subnet.vlan_id,
        environment=subnet.environment,
        parent_id=subnet.parent_id,
        vrf_id=subnet.vrf_id,
        prefix_len=subnet.prefix_len,
        depth=0,
        is_container=False,
        child_prefix_count=0,
        alert_threshold=getattr(subnet, "alert_threshold", None),
        created_at=subnet.created_at,
        updated_at=subnet.updated_at,
        created_by=subnet.created_by,
        updated_by=subnet.updated_by,
    )


def _subnet_snapshot(subnet: Subnet) -> dict:
    return {
        "cidr": subnet.cidr,
        "name": subnet.name,
        "description": subnet.description,
        "gateway": subnet.gateway,
        "vlan_id": subnet.vlan_id,
        "environment": subnet.environment.value,
        "parent_id": subnet.parent_id,
        "vrf_id": subnet.vrf_id,
    }


class SubnetService:
    def __init__(
        self,
        subnet_repo: SubnetRepository,
        ip_repo: IPRecordRepository,
        audit_repo: AuditLogRepository,
        vrf_repo: Optional[VRFRepository] = None,
    ) -> None:
        self._subnets = subnet_repo
        self._ips = ip_repo
        self._audit = audit_repo
        self._vrfs = vrf_repo

    async def create(
        self,
        data: SubnetCreate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> SubnetResponse:
        try:
            network = ipaddress.ip_network(data.cidr, strict=False)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid CIDR: {data.cidr}",
            ) from exc

        prefix_len = network.prefixlen

        if data.gateway is not None:
            gw = ipaddress.ip_address(data.gateway)
            if gw not in network:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Gateway {data.gateway} is not within subnet {data.cidr}",
                )

        # Validate VRF if provided
        if data.vrf_id and self._vrfs:
            vrf = await self._vrfs.find_by_id(data.vrf_id)
            if vrf is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"VRF '{data.vrf_id}' not found",
                )

        # Validate no duplicate CIDR within the same VRF
        existing = await self._subnets.find_by_cidr(data.cidr, vrf_id=data.vrf_id)
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Subnet with CIDR '{data.cidr}' already exists in this VRF",
            )

        # Auto-detect parent if not explicitly provided
        parent_id = data.parent_id
        if parent_id is None:
            candidates = await self._subnets.find_potential_parents(
                prefix_len, vrf_id=data.vrf_id
            )
            best_parent: Optional[Subnet] = None
            best_prefix_len = -1
            for candidate in candidates:
                try:
                    candidate_net = ipaddress.ip_network(candidate.cidr, strict=False)
                    if (
                        network.subnet_of(candidate_net)
                        and candidate.prefix_len > best_prefix_len
                    ):
                        best_parent = candidate
                        best_prefix_len = candidate.prefix_len
                except ValueError:
                    continue
            parent_id = best_parent.id if best_parent else None

        now = datetime.now(timezone.utc)
        doc = {
            "cidr": data.cidr,
            "name": data.name,
            "description": data.description,
            "gateway": data.gateway,
            "vlan_id": data.vlan_id,
            "environment": data.environment.value,
            "parent_id": parent_id,
            "vrf_id": data.vrf_id,
            "prefix_len": prefix_len,
            "alert_threshold": data.alert_threshold,
            "created_at": now,
            "updated_at": now,
            "created_by": username,
            "updated_by": username,
        }

        subnet = await self._subnets.create(doc)

        # Reparent subnets that are contained by the new subnet and share the same
        # current parent — they should now be children of the new subnet
        siblings = await self._subnets.find_all_in_vrf(vrf_id=data.vrf_id)
        to_reparent = []
        for s in siblings:
            if s.id == subnet.id:
                continue
            if s.parent_id != parent_id:
                continue
            try:
                s_net = ipaddress.ip_network(s.cidr, strict=False)
                if s_net.subnet_of(network):
                    to_reparent.append(s.id)
            except ValueError:
                continue

        if to_reparent:
            await self._subnets.reparent_subnets(to_reparent, subnet.id)

        await self._audit.log(
            action=AuditAction.CREATE,
            resource_type=ResourceType.SUBNET,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=subnet.id,
            after=_subnet_snapshot(subnet),
            detail=f"Created subnet {data.cidr}",
        )
        return _to_response(subnet)

    async def get_by_id(self, id: str) -> SubnetResponse:
        subnet = await self._subnets.find_by_id(id)
        if subnet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subnet not found")
        return _to_response(subnet)

    async def list_subnets(
        self,
        filter_: dict,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[SubnetDetailResponse], int]:
        subnets, total = await self._subnets.find_all(filter_, skip=skip, limit=limit)
        if not subnets:
            return [], total

        subnet_ids = [s.id for s in subnets if s.id]
        all_counts = await self._ips.count_by_status_for_subnets(subnet_ids)

        result: list[SubnetDetailResponse] = []
        for subnet in subnets:
            counts = all_counts.get(subnet.id, {})
            try:
                network = ipaddress.ip_network(subnet.cidr, strict=False)
                total_ips = network.num_addresses
            except ValueError:
                total_ips = 0

            result.append(SubnetDetailResponse(
                id=subnet.id,
                cidr=subnet.cidr,
                name=subnet.name,
                description=subnet.description,
                gateway=subnet.gateway,
                vlan_id=subnet.vlan_id,
                environment=subnet.environment,
                parent_id=subnet.parent_id,
                vrf_id=subnet.vrf_id,
                prefix_len=subnet.prefix_len,
                depth=0,
                is_container=False,
                child_prefix_count=0,
                alert_threshold=getattr(subnet, "alert_threshold", None),
                created_at=subnet.created_at,
                updated_at=subnet.updated_at,
                created_by=subnet.created_by,
                updated_by=subnet.updated_by,
                total_ips=total_ips,
                used_ips=counts.get(IPStatus.IN_USE.value, 0),
                free_ips=counts.get(IPStatus.FREE.value, 0),
                reserved_ips=counts.get(IPStatus.RESERVED.value, 0),
            ))
        return result, total

    async def update(
        self,
        id: str,
        data: SubnetUpdate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> SubnetResponse:
        existing = await self._subnets.find_by_id(id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subnet not found")

        if data.gateway is not None:
            try:
                network = ipaddress.ip_network(existing.cidr, strict=False)
                gw = ipaddress.ip_address(data.gateway)
                if gw not in network:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Gateway {data.gateway} is not within subnet {existing.cidr}",
                    )
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Invalid gateway address: {data.gateway}",
                ) from exc

        before_snapshot = _subnet_snapshot(existing)
        update_fields = data.model_dump(exclude_none=True)
        if "environment" in update_fields and hasattr(update_fields["environment"], "value"):
            update_fields["environment"] = update_fields["environment"].value

        update_fields["updated_by"] = username

        if not update_fields:
            return _to_response(existing)

        updated = await self._subnets.update(id, update_fields)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subnet not found")

        await self._audit.log(
            action=AuditAction.UPDATE,
            resource_type=ResourceType.SUBNET,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            before=before_snapshot,
            after=_subnet_snapshot(updated),
            detail=f"Updated subnet {existing.cidr}",
        )
        return _to_response(updated)

    async def delete(
        self,
        id: str,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> None:
        existing = await self._subnets.find_by_id(id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subnet not found")

        # Guard: cannot delete subnet that has child subnets
        children = await self._subnets.find_children(id)
        if children:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot delete subnet '{existing.cidr}' — it has {len(children)} child subnet(s). Delete children first.",
            )

        # Guard: cannot delete subnet that has IP records
        ip_count = await self._ips.count({"subnet_id": id})
        if ip_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot delete subnet '{existing.cidr}' — it has {ip_count} IP record(s) assigned",
            )

        before_snapshot = _subnet_snapshot(existing)
        deleted = await self._subnets.delete(id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete subnet",
            )

        await self._audit.log(
            action=AuditAction.DELETE,
            resource_type=ResourceType.SUBNET,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            before=before_snapshot,
            detail=f"Deleted subnet {existing.cidr}",
        )

    async def get_detail(self, id: str) -> SubnetDetailResponse:
        subnet = await self._subnets.find_by_id(id)
        if subnet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subnet not found")

        counts = await self._ips.count_by_subnet_and_status(id)

        try:
            network = ipaddress.ip_network(subnet.cidr, strict=False)
            total_ips = network.num_addresses
        except ValueError:
            total_ips = 0

        return SubnetDetailResponse(
            id=subnet.id,
            cidr=subnet.cidr,
            name=subnet.name,
            description=subnet.description,
            gateway=subnet.gateway,
            vlan_id=subnet.vlan_id,
            environment=subnet.environment,
            parent_id=subnet.parent_id,
            vrf_id=subnet.vrf_id,
            prefix_len=subnet.prefix_len,
            depth=0,
            is_container=False,
            child_prefix_count=0,
            alert_threshold=getattr(subnet, "alert_threshold", None),
            created_at=subnet.created_at,
            updated_at=subnet.updated_at,
            created_by=subnet.created_by,
            updated_by=subnet.updated_by,
            total_ips=total_ips,
            used_ips=counts.get("In Use", 0),
            free_ips=counts.get("Free", 0),
            reserved_ips=counts.get("Reserved", 0),
        )

    async def build_tree(
        self,
        vrf_id: Optional[str] = None,
        environment: Optional[Environment] = None,
    ) -> list[SubnetTreeNode]:
        """Load all subnets for a VRF and assemble a nested tree in memory."""
        filter_: dict = {"vrf_id": vrf_id}
        if environment:
            filter_["environment"] = environment.value

        all_subnets, _ = await self._subnets.find_all(filter_, skip=0, limit=10_000)
        if not all_subnets:
            return []

        subnet_ids = [s.id for s in all_subnets if s.id]
        ip_counts = await self._ips.count_by_status_for_subnets(subnet_ids)

        # Build children index: parent_id → list[Subnet]
        children_map: dict[Optional[str], list[Subnet]] = {}
        for subnet in all_subnets:
            parent = subnet.parent_id
            if parent not in children_map:
                children_map[parent] = []
            children_map[parent].append(subnet)

        def build_node(subnet: Subnet, depth: int) -> SubnetTreeNode:
            direct_children = children_map.get(subnet.id, [])
            is_container = len(direct_children) > 0

            counts = ip_counts.get(subnet.id, {})
            try:
                network = ipaddress.ip_network(subnet.cidr, strict=False)
                total_ips = network.num_addresses
            except ValueError:
                total_ips = 0

            if is_container:
                child_space = 0
                for child in direct_children:
                    try:
                        child_space += ipaddress.ip_network(
                            child.cidr, strict=False
                        ).num_addresses
                    except ValueError:
                        pass
                used_ips = child_space
                free_ips = max(0, total_ips - child_space)
                reserved_ips = 0
                utilization_pct = round((child_space / total_ips * 100), 1) if total_ips > 0 else 0.0
            else:
                used_ips = counts.get(IPStatus.IN_USE.value, 0)
                free_ips = counts.get(IPStatus.FREE.value, 0)
                reserved_ips = counts.get(IPStatus.RESERVED.value, 0)
                utilization_pct = round((used_ips / total_ips * 100), 1) if total_ips > 0 else 0.0

            child_nodes = [build_node(c, depth + 1) for c in direct_children]

            return SubnetTreeNode(
                id=subnet.id,
                cidr=subnet.cidr,
                name=subnet.name,
                description=subnet.description,
                gateway=subnet.gateway,
                vlan_id=subnet.vlan_id,
                environment=subnet.environment,
                parent_id=subnet.parent_id,
                vrf_id=subnet.vrf_id,
                prefix_len=subnet.prefix_len,
                depth=depth,
                is_container=is_container,
                child_prefix_count=len(direct_children),
                alert_threshold=getattr(subnet, "alert_threshold", None),
                created_at=subnet.created_at,
                updated_at=subnet.updated_at,
                created_by=subnet.created_by,
                updated_by=subnet.updated_by,
                total_ips=total_ips,
                used_ips=used_ips,
                free_ips=free_ips,
                reserved_ips=reserved_ips,
                key=subnet.id,
                utilization_pct=utilization_pct,
                children=child_nodes,
            )

        roots = children_map.get(None, [])
        return [build_node(root, 0) for root in roots]

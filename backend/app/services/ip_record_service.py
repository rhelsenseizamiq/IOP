import ipaddress
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status

from app.models.audit_log import AuditAction, ResourceType
from app.models.ip_record import IPRecord, IPStatus, OSType, Environment
from app.models.subnet import Subnet
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.ip_record_repository import IPRecordRepository
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.vrf_repository import VRFRepository
from app.schemas.ip_record import IPRecordCreate, IPRecordResponse, IPRecordUpdate

logger = logging.getLogger(__name__)


def _to_response(record: IPRecord) -> IPRecordResponse:
    return IPRecordResponse(
        id=record.id,
        ip_address=record.ip_address,
        hostname=record.hostname,
        os_type=record.os_type,
        subnet_id=record.subnet_id,
        status=record.status,
        environment=record.environment,
        owner=record.owner,
        description=record.description,
        created_at=record.created_at,
        updated_at=record.updated_at,
        created_by=record.created_by,
        updated_by=record.updated_by,
        reserved_at=record.reserved_at,
        reserved_by=record.reserved_by,
    )


def _record_snapshot(record: IPRecord) -> dict:
    return {
        "ip_address": record.ip_address,
        "hostname": record.hostname,
        "os_type": record.os_type.value,
        "subnet_id": record.subnet_id,
        "status": record.status.value,
        "environment": record.environment.value,
        "owner": record.owner,
        "description": record.description,
        "reserved_by": record.reserved_by,
    }


class IPRecordService:
    def __init__(
        self,
        ip_repo: IPRecordRepository,
        subnet_repo: SubnetRepository,
        audit_repo: AuditLogRepository,
        vrf_repo: Optional[VRFRepository] = None,
    ) -> None:
        self._ips = ip_repo
        self._subnets = subnet_repo
        self._audit = audit_repo
        self._vrfs = vrf_repo

    async def create(
        self,
        data: IPRecordCreate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> IPRecordResponse:
        # Validate subnet exists
        subnet = await self._subnets.find_by_id(data.subnet_id)
        if subnet is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subnet '{data.subnet_id}' not found",
            )

        # Validate IP is within subnet CIDR and version matches
        network = ipaddress.ip_network(subnet.cidr, strict=False)
        ip_addr = ipaddress.ip_address(data.ip_address)
        if ip_addr.version != network.version:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"IP version mismatch: address {data.ip_address} is IPv{ip_addr.version} "
                    f"but subnet {subnet.cidr} is IPv{network.version}"
                ),
            )
        if ip_addr not in network:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"IP address {data.ip_address} is not within subnet {subnet.cidr}",
            )

        # VRF-scoped uniqueness check
        vrf_id = subnet.vrf_id
        enforce_unique = True
        if vrf_id and self._vrfs:
            vrf = await self._vrfs.find_by_id(vrf_id)
            if vrf is not None:
                enforce_unique = vrf.enforce_unique

        if enforce_unique:
            existing = await self._ips.find_by_ip_and_vrf(data.ip_address, vrf_id)
            if existing is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"IP address {data.ip_address} already exists in this VRF",
                )

        now = datetime.now(timezone.utc)
        doc = {
            "ip_address": data.ip_address,
            "hostname": data.hostname,
            "os_type": data.os_type.value,
            "subnet_id": data.subnet_id,
            "vrf_id": vrf_id,
            "status": data.status.value,
            "environment": data.environment.value,
            "owner": data.owner,
            "description": data.description,
            "created_at": now,
            "updated_at": now,
            "created_by": username,
            "updated_by": username,
            "reserved_at": None,
            "reserved_by": None,
        }

        record = await self._ips.create(doc)
        await self._audit.log(
            action=AuditAction.CREATE,
            resource_type=ResourceType.IP_RECORD,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=record.id,
            after=_record_snapshot(record),
            detail=f"Created IP record {data.ip_address}",
        )
        return _to_response(record)

    async def get_by_id(self, id: str) -> IPRecordResponse:
        record = await self._ips.find_by_id(id)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IP record not found")
        return _to_response(record)

    async def get_by_ip(self, ip_address: str) -> IPRecordResponse:
        record = await self._ips.find_by_ip(ip_address)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"IP record for {ip_address} not found",
            )
        return _to_response(record)

    async def list_records(
        self,
        filter_: dict,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[IPRecordResponse], int]:
        records, total = await self._ips.find_all(filter_, skip=skip, limit=limit)
        return [_to_response(r) for r in records], total

    async def update(
        self,
        id: str,
        data: IPRecordUpdate,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> IPRecordResponse:
        existing = await self._ips.find_by_id(id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IP record not found")

        before_snapshot = _record_snapshot(existing)

        update_fields = data.model_dump(exclude_none=True)
        # Serialize enum values
        for key in ("os_type", "status", "environment"):
            if key in update_fields and hasattr(update_fields[key], "value"):
                update_fields[key] = update_fields[key].value

        update_fields["updated_by"] = username

        updated = await self._ips.update(id, update_fields)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IP record not found")

        await self._audit.log(
            action=AuditAction.UPDATE,
            resource_type=ResourceType.IP_RECORD,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            before=before_snapshot,
            after=_record_snapshot(updated),
            detail=f"Updated IP record {existing.ip_address}",
        )
        return _to_response(updated)

    async def delete(
        self,
        id: str,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> None:
        existing = await self._ips.find_by_id(id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IP record not found")

        before_snapshot = _record_snapshot(existing)
        deleted = await self._ips.delete(id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete IP record",
            )

        await self._audit.log(
            action=AuditAction.DELETE,
            resource_type=ResourceType.IP_RECORD,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            before=before_snapshot,
            detail=f"Deleted IP record {existing.ip_address}",
        )

    async def reserve(
        self,
        id: str,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> IPRecordResponse:
        record = await self._ips.find_by_id(id)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IP record not found")

        before_snapshot = _record_snapshot(record)
        now = datetime.now(timezone.utc)

        # Atomic: only succeeds if status is still Free at update time
        updated = await self._ips.update_with_filter(
            id,
            {"status": IPStatus.FREE.value},
            {
                "status": IPStatus.RESERVED.value,
                "reserved_by": username,
                "reserved_at": now,
                "updated_by": username,
            },
        )
        if updated is None:
            current = await self._ips.find_by_id(id)
            current_status = current.status.value if current else "unknown"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"IP {record.ip_address} cannot be reserved — current status: {current_status}",
            )

        await self._audit.log(
            action=AuditAction.RESERVE,
            resource_type=ResourceType.IP_RECORD,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            before=before_snapshot,
            after=_record_snapshot(updated),
            detail=f"Reserved IP {record.ip_address}",
        )
        return _to_response(updated)

    async def export_records(self, filter_: dict) -> tuple[list[IPRecord], dict[str, str]]:
        """Return matching records (capped at 5,000) + a cidr map for subnet_id → cidr."""
        records, _ = await self._ips.find_all(filter_, skip=0, limit=5_000)
        # Build subnet_id → cidr map from the records' subnet_ids
        subnet_ids = {r.subnet_id for r in records}
        cidr_map: dict[str, str] = {}
        for sid in subnet_ids:
            subnet = await self._subnets.find_by_id(sid)
            if subnet:
                cidr_map[sid] = subnet.cidr
        return records, cidr_map

    async def import_records(
        self,
        rows: list[dict],
        username: str,
        user_role: str,
        client_ip: str,
    ) -> dict:
        """
        Import IP records from parsed CSV rows.
        Each row dict must have keys: ip_address, hostname, os_type,
        subnet_cidr, status, environment, owner, description.
        Returns {"imported": N, "errors": [{"row": N, "ip": "...", "error": "..."}]}.
        """
        # Build CIDR → Subnet map once for the whole batch
        all_subnets, _ = await self._subnets.find_all({}, skip=0, limit=10_000)
        cidr_to_subnet: dict[str, Subnet] = {s.cidr: s for s in all_subnets}

        imported = 0
        errors: list[dict] = []

        for idx, row in enumerate(rows):
            row_num = idx + 2  # 1-based, row 1 is the header
            ip = row.get("ip_address", "").strip()
            try:
                # ── Validate IP ────────────────────────────────────────────
                if not ip:
                    raise ValueError("ip_address is required")
                try:
                    ip_addr = ipaddress.ip_address(ip)
                except ValueError as exc:
                    raise ValueError(f"Invalid IP address: {ip}") from exc

                # ── Validate OS type ───────────────────────────────────────
                raw_os = row.get("os_type", "").strip()
                try:
                    os_type = OSType(raw_os)
                except ValueError:
                    raise ValueError(
                        f"os_type must be one of {[e.value for e in OSType]}, got '{raw_os}'"
                    )

                # ── Validate environment ───────────────────────────────────
                raw_env = row.get("environment", "").strip()
                try:
                    environment = Environment(raw_env)
                except ValueError:
                    raise ValueError(
                        f"environment must be one of {[e.value for e in Environment]}, got '{raw_env}'"
                    )

                # ── Validate status (optional, default Free) ───────────────
                raw_status = row.get("status", "").strip() or "Free"
                try:
                    ip_status = IPStatus(raw_status)
                except ValueError:
                    raise ValueError(
                        f"status must be one of {[e.value for e in IPStatus]}, got '{raw_status}'"
                    )

                # ── Resolve subnet by CIDR ─────────────────────────────────
                cidr = row.get("subnet_cidr", "").strip()
                if not cidr:
                    raise ValueError("subnet_cidr is required")
                subnet = cidr_to_subnet.get(cidr)
                if subnet is None:
                    raise ValueError(f"Subnet '{cidr}' not found in the database")

                # ── Verify IP version matches subnet and is within range ───
                network = ipaddress.ip_network(subnet.cidr, strict=False)
                if ip_addr.version != network.version:
                    raise ValueError(
                        f"IP version mismatch: {ip} is IPv{ip_addr.version} "
                        f"but subnet {subnet.cidr} is IPv{network.version}"
                    )
                if ip_addr not in network:
                    raise ValueError(f"IP {ip} is not within subnet {subnet.cidr}")

                # ── Check for duplicate ────────────────────────────────────
                existing = await self._ips.find_by_ip(ip)
                if existing is not None:
                    raise ValueError(f"IP address {ip} already exists")

                # ── Insert record ──────────────────────────────────────────
                now = datetime.now(timezone.utc)
                doc = {
                    "ip_address": ip,
                    "hostname": row.get("hostname", "").strip() or None,
                    "os_type": os_type.value,
                    "subnet_id": subnet.id,
                    "status": ip_status.value,
                    "environment": environment.value,
                    "owner": row.get("owner", "").strip() or None,
                    "description": row.get("description", "").strip() or None,
                    "created_at": now,
                    "updated_at": now,
                    "created_by": username,
                    "updated_by": username,
                    "reserved_at": None,
                    "reserved_by": None,
                }
                record = await self._ips.create(doc)
                await self._audit.log(
                    action=AuditAction.CREATE,
                    resource_type=ResourceType.IP_RECORD,
                    username=username,
                    user_role=user_role,
                    client_ip=client_ip,
                    resource_id=record.id,
                    after=_record_snapshot(record),
                    detail=f"Imported IP record {ip}",
                )
                imported += 1

            except Exception as exc:  # noqa: BLE001
                errors.append({"row": row_num, "ip": ip, "error": str(exc)})

        return {"imported": imported, "errors": errors}

    async def release(
        self,
        id: str,
        username: str,
        user_role: str,
        client_ip: str,
    ) -> IPRecordResponse:
        record = await self._ips.find_by_id(id)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IP record not found")

        before_snapshot = _record_snapshot(record)

        # Atomic: only succeeds if status is still Reserved at update time
        updated = await self._ips.update_with_filter(
            id,
            {"status": IPStatus.RESERVED.value},
            {
                "status": IPStatus.FREE.value,
                "reserved_by": None,
                "reserved_at": None,
                "updated_by": username,
            },
        )
        if updated is None:
            current = await self._ips.find_by_id(id)
            current_status = current.status.value if current else "unknown"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"IP {record.ip_address} cannot be released — current status: {current_status}",
            )

        await self._audit.log(
            action=AuditAction.RELEASE,
            resource_type=ResourceType.IP_RECORD,
            username=username,
            user_role=user_role,
            client_ip=client_ip,
            resource_id=id,
            before=before_snapshot,
            after=_record_snapshot(updated),
            detail=f"Released IP {record.ip_address}",
        )
        return _to_response(updated)

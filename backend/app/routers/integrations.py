import ipaddress
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.models.user import UserInToken
from app.repositories.ip_record_repository import IPRecordRepository
from app.repositories.subnet_repository import SubnetRepository
from app.schemas.device42 import (
    Device42DiscoverRequest,
    Device42IP,
    Device42ImportRequest,
    Device42ImportResult,
)
from app.schemas.integrations import (
    VsphereDiscoverRequest,
    VsphereImportRequest,
    VsphereImportResult,
    VsphereVM,
)
from app.schemas.paloalto import (
    PaloAltoDiscoverRequest,
    PaloAltoDiscoverResult,
    PaloAltoImportRequest,
    PaloAltoImportResult,
)
from app.services.device42_service import Device42Service
from app.services.paloalto_service import PaloAltoService
from app.services.vsphere_service import VsphereService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/integrations", tags=["integrations"])

_OPERATOR = require_role("Operator", "Administrator")


# ── vSphere ────────────────────────────────────────────────────────────────────

@router.post("/vsphere/discover", response_model=list[VsphereVM])
async def vsphere_discover(
    body: VsphereDiscoverRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> list[VsphereVM]:
    try:
        return VsphereService.discover(
            host=body.host,
            username=body.username,
            password=body.password,
            datacenter=body.datacenter,
            verify_ssl=body.verify_ssl,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/vsphere/import", response_model=VsphereImportResult)
async def vsphere_import(
    body: VsphereImportRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> VsphereImportResult:
    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    created = skipped = 0
    errors: list[str] = []

    for vm in body.vms:
        try:
            try:
                ipaddress.ip_address(vm.ip_address)
            except ValueError as exc:
                raise ValueError(f"Invalid IP address '{vm.ip_address}'") from exc

            subnet = await subnet_repo.find_by_id(vm.subnet_id)
            if subnet is None:
                raise ValueError(f"Subnet '{vm.subnet_id}' not found")

            network = ipaddress.ip_network(subnet.cidr, strict=False)
            if ipaddress.ip_address(vm.ip_address) not in network:
                raise ValueError(f"IP {vm.ip_address} is not within subnet {subnet.cidr}")

            if await ip_repo.find_by_ip(vm.ip_address) is not None:
                skipped += 1
                continue

            now = datetime.now(timezone.utc)
            await ip_repo.create({
                "ip_address": vm.ip_address,
                "hostname": vm.hostname or vm.vm_name,
                "os_type": vm.os_type,
                "subnet_id": vm.subnet_id,
                "vrf_id": subnet.vrf_id,
                "status": "In Use",
                "environment": vm.environment,
                "owner": None,
                "description": f"Imported from vSphere: {vm.vm_name}",
                "created_at": now,
                "updated_at": now,
                "created_by": current_user.sub,
                "updated_by": current_user.sub,
                "reserved_at": None,
                "reserved_by": None,
            })
            created += 1

        except ValueError as exc:
            errors.append(f"{vm.vm_name} ({vm.ip_address}): {exc}")
        except Exception as exc:
            errors.append(f"{vm.vm_name} ({vm.ip_address}): unexpected error — {exc}")

    return VsphereImportResult(created=created, skipped=skipped, errors=errors)


# ── Device42 ───────────────────────────────────────────────────────────────────

@router.post("/device42/discover", response_model=list[Device42IP])
async def device42_discover(
    body: Device42DiscoverRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> list[Device42IP]:
    """Connect to Device42 and return all discovered IP addresses."""
    try:
        return await Device42Service.discover(
            host=body.host,
            username=body.username,
            password=body.password,
            verify_ssl=body.verify_ssl,
            limit=body.limit,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/device42/import", response_model=Device42ImportResult)
async def device42_import(
    body: Device42ImportRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> Device42ImportResult:
    """Bulk-import selected Device42 IPs as IPAM records."""
    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    created = skipped = 0
    errors: list[str] = []

    for ip_item in body.ips:
        try:
            try:
                ipaddress.ip_address(ip_item.ip_address)
            except ValueError as exc:
                raise ValueError(f"Invalid IP '{ip_item.ip_address}'") from exc

            subnet = await subnet_repo.find_by_id(ip_item.subnet_id)
            if subnet is None:
                raise ValueError(f"Subnet '{ip_item.subnet_id}' not found")

            network = ipaddress.ip_network(subnet.cidr, strict=False)
            if ipaddress.ip_address(ip_item.ip_address) not in network:
                raise ValueError(f"IP {ip_item.ip_address} is not within {subnet.cidr}")

            if await ip_repo.find_by_ip(ip_item.ip_address) is not None:
                skipped += 1
                continue

            now = datetime.now(timezone.utc)
            await ip_repo.create({
                "ip_address": ip_item.ip_address,
                "hostname": ip_item.hostname or ip_item.device_name,
                "os_type": ip_item.os_type,
                "subnet_id": ip_item.subnet_id,
                "vrf_id": subnet.vrf_id,
                "status": "In Use",
                "environment": ip_item.environment,
                "owner": None,
                "description": f"Imported from Device42: {ip_item.device_name or ip_item.ip_address}",
                "created_at": now,
                "updated_at": now,
                "created_by": current_user.sub,
                "updated_by": current_user.sub,
                "reserved_at": None,
                "reserved_by": None,
            })
            created += 1

        except ValueError as exc:
            errors.append(f"{ip_item.ip_address}: {exc}")
        except Exception as exc:
            errors.append(f"{ip_item.ip_address}: unexpected error — {exc}")

    return Device42ImportResult(created=created, skipped=skipped, errors=errors)


# ── PaloAlto ───────────────────────────────────────────────────────────────────

@router.post("/paloalto/discover", response_model=PaloAltoDiscoverResult)
async def paloalto_discover(
    body: PaloAltoDiscoverRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> PaloAltoDiscoverResult:
    """Connect to PaloAlto firewall and return address objects, interfaces, and ARP table."""
    try:
        return await PaloAltoService.discover(
            host=body.host,
            username=body.username,
            password=body.password,
            verify_ssl=body.verify_ssl,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/paloalto/import", response_model=PaloAltoImportResult)
async def paloalto_import(
    body: PaloAltoImportRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> PaloAltoImportResult:
    """Bulk-import selected PaloAlto address objects as IPAM records."""
    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    created = skipped = 0
    errors: list[str] = []

    for addr in body.addresses:
        try:
            try:
                ipaddress.ip_address(addr.ip_address)
            except ValueError as exc:
                raise ValueError(f"Invalid IP '{addr.ip_address}'") from exc

            subnet = await subnet_repo.find_by_id(addr.subnet_id)
            if subnet is None:
                raise ValueError(f"Subnet '{addr.subnet_id}' not found")

            network = ipaddress.ip_network(subnet.cidr, strict=False)
            if ipaddress.ip_address(addr.ip_address) not in network:
                raise ValueError(f"IP {addr.ip_address} is not within {subnet.cidr}")

            if await ip_repo.find_by_ip(addr.ip_address) is not None:
                skipped += 1
                continue

            now = datetime.now(timezone.utc)
            await ip_repo.create({
                "ip_address": addr.ip_address,
                "hostname": addr.hostname,
                "os_type": addr.os_type,
                "subnet_id": addr.subnet_id,
                "vrf_id": subnet.vrf_id,
                "status": "In Use",
                "environment": addr.environment,
                "owner": None,
                "description": addr.description or f"Imported from PaloAlto",
                "created_at": now,
                "updated_at": now,
                "created_by": current_user.sub,
                "updated_by": current_user.sub,
                "reserved_at": None,
                "reserved_by": None,
            })
            created += 1

        except ValueError as exc:
            errors.append(f"{addr.ip_address}: {exc}")
        except Exception as exc:
            errors.append(f"{addr.ip_address}: unexpected error — {exc}")

    return PaloAltoImportResult(created=created, skipped=skipped, errors=errors)

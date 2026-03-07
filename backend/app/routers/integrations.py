import ipaddress
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.models.user import UserInToken
from app.repositories.ip_record_repository import IPRecordRepository
from app.repositories.subnet_repository import SubnetRepository
from app.schemas.integrations import (
    VsphereDiscoverRequest,
    VsphereImportRequest,
    VsphereImportResult,
    VsphereVM,
)
from app.services.vsphere_service import VsphereService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/integrations", tags=["integrations"])

_OPERATOR = require_role("Operator", "Administrator")


@router.post("/vsphere/discover", response_model=list[VsphereVM])
async def vsphere_discover(
    body: VsphereDiscoverRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> list[VsphereVM]:
    """Connect to vCenter and return a list of discovered VMs with their IPs."""
    try:
        vms = VsphereService.discover(
            host=body.host,
            username=body.username,
            password=body.password,
            datacenter=body.datacenter,
            verify_ssl=body.verify_ssl,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    return vms


@router.post("/vsphere/import", response_model=VsphereImportResult)
async def vsphere_import(
    body: VsphereImportRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> VsphereImportResult:
    """
    Bulk-import selected VMs as IP records.
    Duplicates (same IP already in the subnet) are skipped with a warning.
    """
    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    created = 0
    skipped = 0
    errors: list[str] = []

    for vm in body.vms:
        try:
            # Validate IP
            try:
                ipaddress.ip_address(vm.ip_address)
            except ValueError as exc:
                raise ValueError(f"Invalid IP address '{vm.ip_address}'") from exc

            # Check subnet exists
            subnet = await subnet_repo.find_by_id(vm.subnet_id)
            if subnet is None:
                raise ValueError(f"Subnet '{vm.subnet_id}' not found")

            # Check IP is within the subnet
            network = ipaddress.ip_network(subnet.cidr, strict=False)
            ip_addr = ipaddress.ip_address(vm.ip_address)
            if ip_addr not in network:
                raise ValueError(f"IP {vm.ip_address} is not within subnet {subnet.cidr}")

            # Check for duplicate
            existing = await ip_repo.find_by_ip(vm.ip_address)
            if existing is not None:
                skipped += 1
                continue

            now = datetime.now(timezone.utc)
            doc = {
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
            }
            await ip_repo.create(doc)
            created += 1

        except ValueError as exc:
            errors.append(f"{vm.vm_name} ({vm.ip_address}): {exc}")
        except Exception as exc:
            errors.append(f"{vm.vm_name} ({vm.ip_address}): unexpected error — {exc}")

    return VsphereImportResult(created=created, skipped=skipped, errors=errors)

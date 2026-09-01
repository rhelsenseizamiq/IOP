import ipaddress
import json
import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

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
    PaloAltoBulkSaveRequest,
    PaloAltoBulkSaveResult,
    PaloAltoCheckBulkRequest,
    PaloAltoCheckLogEntry,
    PaloAltoCheckRequest,
    PaloAltoCheckResult,
    PaloAltoDiscoverRequest,
    PaloAltoDiscoverResult,
    PaloAltoImportRequest,
    PaloAltoImportResult,
    PaloAltoRuleHit,
    PaloAltoSaveRequest,
    PaloAltoSaveResult,
    PaloAltoScanSubnetResult,
    PaloAltoTrafficLogRequest,
    PaloAltoTrafficLogResult,
)
from app.schemas.zabbix import (
    ZabbixDiscoverRequest,
    ZabbixHost,
    ZabbixImportRequest,
    ZabbixImportResult,
)
from app.services.device42_service import Device42Service
from app.services.paloalto_service import MAX_BULK_IPS, PaloAltoService
from app.services.vsphere_service import VsphereService
from app.services.zabbix_service import ZabbixService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/integrations", tags=["integrations"])

_OPERATOR = require_role("Operator", "Administrator", "SuperAdmin")
# Traditional Integrations actions (vSphere/Device42/Zabbix/PaloAlto discover
# + import) are SuperAdmin-only — Operator and Administrator can still see
# this page, just not trigger these. The PaloAlto Check family below (check-*,
# save-*, scan-subnet) is a separate feature and stays at _OPERATOR.
_SUPERADMIN_ONLY = require_role("SuperAdmin")


# ── vSphere ────────────────────────────────────────────────────────────────────

@router.post("/vsphere/discover", response_model=list[VsphereVM])
async def vsphere_discover(
    body: VsphereDiscoverRequest,
    current_user: UserInToken = Depends(_SUPERADMIN_ONLY),
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
    current_user: UserInToken = Depends(_SUPERADMIN_ONLY),
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
    current_user: UserInToken = Depends(_SUPERADMIN_ONLY),
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
    current_user: UserInToken = Depends(_SUPERADMIN_ONLY),
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


# ── Zabbix ─────────────────────────────────────────────────────────────────────
# Unlike Device42/PaloAlto, credentials are never accepted from the request —
# only from server config (ZABBIX_HOST/ZABBIX_TOKEN in .env.api), matching how
# the Check Availability > Zabbix lookup and the nightly sync script work too.

def _zabbix_settings() -> tuple[str, str]:
    from app.config import get_settings

    settings = get_settings()
    host = getattr(settings, "ZABBIX_HOST", None)
    token = getattr(settings, "ZABBIX_TOKEN", None)
    if not host or not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Zabbix is not configured (ZABBIX_HOST/ZABBIX_TOKEN missing)",
        )
    return host, token


@router.post("/zabbix/discover", response_model=list[ZabbixHost])
async def zabbix_discover(
    body: ZabbixDiscoverRequest,
    current_user: UserInToken = Depends(_SUPERADMIN_ONLY),
) -> list[ZabbixHost]:
    """Connect to Zabbix (using the server-configured token) and return all
    monitored hosts' IP addresses."""
    host, token = _zabbix_settings()
    try:
        return await ZabbixService.discover(host=host, token=token, limit=body.limit)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/zabbix/import", response_model=ZabbixImportResult)
async def zabbix_import(
    body: ZabbixImportRequest,
    current_user: UserInToken = Depends(_SUPERADMIN_ONLY),
) -> ZabbixImportResult:
    """Bulk-import selected Zabbix hosts as IPAM records."""
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
                "os_type": "Unknown",
                "subnet_id": ip_item.subnet_id,
                "vrf_id": subnet.vrf_id,
                "status": "In Use",
                "environment": ip_item.environment,
                "owner": None,
                "description": f"Imported from Zabbix: {ip_item.device_name or ip_item.ip_address}",
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

    return ZabbixImportResult(created=created, skipped=skipped, errors=errors)


# ── PaloAlto ───────────────────────────────────────────────────────────────────

def _paloalto_settings_or_503():
    """Server-configured PaloAlto credentials for the real-time check
    endpoints (matches Zabbix's pattern — never accepted from the request)."""
    from app.config import get_settings

    settings = get_settings()
    hosts = [h.strip() for h in (settings.PALOALTO_HOSTS or "").split(",") if h.strip()]
    if not hosts or not settings.PALOALTO_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PaloAlto not configured (PALOALTO_HOSTS/PALOALTO_USERNAME missing)",
        )
    return settings, hosts


@router.post("/paloalto/discover", response_model=PaloAltoDiscoverResult)
async def paloalto_discover(
    body: PaloAltoDiscoverRequest,
    current_user: UserInToken = Depends(_SUPERADMIN_ONLY),
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


@router.post("/paloalto/check-ip", response_model=PaloAltoCheckResult)
async def paloalto_check_ip(
    body: PaloAltoCheckRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> PaloAltoCheckResult:
    """Real-time single-IP lookup across every server-configured PaloAlto
    firewall (PALOALTO_HOSTS) — powers the PaloAlto Check tab. Unlike
    discover/import, credentials are server-configured only, matching Zabbix."""
    try:
        ipaddress.ip_address(body.ip_address)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid IP address '{body.ip_address}'",
        ) from exc

    settings, hosts = _paloalto_settings_or_503()
    result = await PaloAltoService.check_ip(
        hosts=hosts,
        username=settings.PALOALTO_USERNAME,
        password=settings.PALOALTO_PASSWORD,
        ip=body.ip_address,
    )
    await PaloAltoService.log_check(get_database(), result, "check-ip", current_user.sub)
    return result


def _resolve_bulk_ips(body: PaloAltoCheckBulkRequest) -> list[str]:
    """Shared by check-subnet and the streaming endpoint: expands a CIDR
    and/or explicit IP list into a de-duped, size-capped list of IPs."""
    if not body.cidr and not body.ip_addresses:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide either 'cidr' or 'ip_addresses'",
        )

    ips: list[str] = []
    if body.cidr:
        try:
            network = ipaddress.ip_network(body.cidr.strip(), strict=False)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid CIDR '{body.cidr}'",
            ) from exc
        # Reject oversized networks BEFORE materializing any addresses —
        # network.hosts() on something like a /8 (or worse, an IPv6 CIDR)
        # would otherwise try to enumerate millions/trillions of addresses
        # into a list before the length check below ever runs.
        if network.num_addresses > MAX_BULK_IPS + 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"CIDR '{body.cidr}' has {network.num_addresses} addresses — "
                    f"bulk check is limited to {MAX_BULK_IPS} (up to a /24)."
                ),
            )
        # hosts() excludes network/broadcast for prefixes < 31; for /31 and
        # /32 fall back to every address in the network.
        host_iter = list(network.hosts()) or list(network)
        ips.extend(str(ip) for ip in host_iter)
    if body.ip_addresses:
        for raw in body.ip_addresses:
            try:
                ipaddress.ip_address(raw.strip())
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Invalid IP address '{raw}'",
                ) from exc
            ips.append(raw.strip())

    # De-dupe while preserving order (CIDR + explicit list could overlap).
    seen: set[str] = set()
    ips = [ip for ip in ips if not (ip in seen or seen.add(ip))]

    if len(ips) > MAX_BULK_IPS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Bulk check is limited to {MAX_BULK_IPS} addresses "
                f"(up to a /24). Your request has {len(ips)}."
            ),
        )
    return ips


@router.post("/paloalto/check-subnet", response_model=list[PaloAltoCheckResult])
async def paloalto_check_subnet(
    body: PaloAltoCheckBulkRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> list[PaloAltoCheckResult]:
    """Bulk version of /paloalto/check-ip — either a CIDR (expanded to its
    host addresses, up to MAX_BULK_IPS) or an explicit list of IPs. Powers
    the PaloAlto Check page's subnet/multi-IP scan mode."""
    ips = _resolve_bulk_ips(body)
    if not ips:
        return []

    settings, hosts = _paloalto_settings_or_503()
    results = await PaloAltoService.check_ips(
        hosts=hosts,
        username=settings.PALOALTO_USERNAME,
        password=settings.PALOALTO_PASSWORD,
        ips=ips,
    )
    await PaloAltoService.log_checks_bulk(get_database(), results, "check-subnet", current_user.sub)
    return results


@router.post("/paloalto/check-stream")
async def paloalto_check_stream(
    body: PaloAltoCheckBulkRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> StreamingResponse:
    """Real-time streaming version of check-ip/check-subnet (Server-Sent
    Events) — same underlying check, but each trace-log line is pushed to
    the client the moment it's produced instead of only at the end. Accepts
    the same body as check-subnet (a single IP works too: ip_addresses
    with one element). Auth is a normal Bearer token on the POST, same as
    every other endpoint here — the frontend can't use the native
    EventSource API (GET-only) so it reads this via fetch()'s streaming
    body instead.

    `X-Accel-Buffering: no` tells nginx not to buffer this response —
    without it a reverse proxy would collect the whole stream before
    forwarding it, silently turning "real-time" into "all at once"."""
    ips = _resolve_bulk_ips(body)
    settings, hosts = _paloalto_settings_or_503()

    async def event_stream():
        results: list[PaloAltoCheckResult] = []
        if not ips:
            yield "event: complete\ndata: {}\n\n"
            return
        try:
            async for kind, ip, payload in PaloAltoService.check_ips_streaming(
                hosts, settings.PALOALTO_USERNAME, settings.PALOALTO_PASSWORD, ips,
            ):
                if kind == "log":
                    yield f"event: log\ndata: {json.dumps({'ip': ip, 'line': payload})}\n\n"
                elif kind == "result":
                    results.append(payload)
                    yield f"event: result\ndata: {payload.model_dump_json()}\n\n"
                elif kind == "error":
                    yield f"event: error\ndata: {json.dumps({'message': payload})}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
        if results:
            await PaloAltoService.log_checks_bulk(get_database(), results, "check-stream", current_user.sub)
        yield "event: complete\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/paloalto/check-logs", response_model=list[PaloAltoCheckLogEntry])
async def paloalto_check_logs(
    ip_address: Optional[str] = None,
    limit: int = 50,
    current_user: UserInToken = Depends(_OPERATOR),
) -> list[PaloAltoCheckLogEntry]:
    """Recent PaloAlto Check history (last 30 days, TTL-purged automatically)
    — optionally filtered to one address. Newest first."""
    db = get_database()
    query: dict = {"ip_address": ip_address} if ip_address else {}
    limit = max(1, min(limit, 200))
    cursor = db["paloalto_check_logs"].find(query).sort("checked_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    return [
        PaloAltoCheckLogEntry(
            ip_address=d["ip_address"],
            found=d["found"],
            hostname=d.get("hostname"),
            log=d.get("log", []),
            matches_count=d.get("matches_count", 0),
            nat_matches_count=d.get("nat_matches_count", 0),
            security_matches_total=d.get("security_matches_total", 0),
            source=d.get("source", "unknown"),
            checked_by=d.get("checked_by", "unknown"),
            checked_at=d["checked_at"].isoformat(),
        )
        for d in docs
    ]


@router.post("/paloalto/traffic-logs", response_model=PaloAltoTrafficLogResult)
async def paloalto_traffic_logs(
    body: PaloAltoTrafficLogRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> PaloAltoTrafficLogResult:
    """PaloAlto's own traffic log history for one address (default last 30
    days) — real observed sessions from PAN-OS's own log database, not our
    check-history. Slower than a normal check (PAN-OS log queries are an
    async job), so this is a separate, explicit action from the PaloAlto
    Check page rather than something run automatically on every search."""
    try:
        ipaddress.ip_address(body.ip_address)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid IP address '{body.ip_address}'",
        ) from exc
    days = max(1, min(body.days, 90))

    settings, hosts = _paloalto_settings_or_503()
    entries, errors, truncated = await PaloAltoService.get_traffic_logs(
        hosts=hosts,
        username=settings.PALOALTO_USERNAME,
        password=settings.PALOALTO_PASSWORD,
        ip=body.ip_address,
        days=days,
    )
    return PaloAltoTrafficLogResult(
        ip_address=body.ip_address,
        days=days,
        entries=entries,
        truncated=truncated,
        errors=errors,
    )


def _find_subnet_for_ip(ip: str, subnets: list) -> Optional[tuple[str, str]]:
    """Longest-prefix match against the caller's existing subnets. Returns
    (subnet_id, cidr) or None if nothing contains this address."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    best: Optional[tuple[str, str]] = None
    best_prefix = -1
    for s in subnets:
        try:
            network = ipaddress.ip_network(s.cidr, strict=False)
        except ValueError:
            continue
        if addr.version == network.version and addr in network and network.prefixlen > best_prefix:
            best = (s.id, s.cidr)
            best_prefix = network.prefixlen
    return best


async def _save_paloalto_result(
    result: PaloAltoCheckResult, current_user: UserInToken,
) -> PaloAltoSaveResult:
    """Commits one PaloAlto Check finding into IP Records — creates the
    record if missing, updates it if it exists. Only meaningful for a
    found address; a Reserved record's status is never overwritten, same
    asymmetric rule as the nightly syncs."""
    if not result.found:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{result.ip_address} has no PaloAlto evidence — nothing to save.",
        )

    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    all_subnets = await subnet_repo.find_all_in_vrf(vrf_id=None)
    match = _find_subnet_for_ip(result.ip_address, all_subnets)
    if match is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"No matching subnet in your database for {result.ip_address} — add the subnet first.",
        )
    subnet_id, subnet_cidr = match

    hostname = result.hostname or (result.matches[0].address_name if result.matches else None)

    reasons = []
    if result.matches:
        reasons.append("address object/ARP")
    if result.nat_matches:
        reasons.append(f"{len(result.nat_matches)} NAT rule(s)")
    if result.security_matches_total:
        reasons.append(f"{result.security_matches_total} security rule(s)")
    description = f"PaloAlto Check: {', '.join(reasons)}"

    existing = await ip_repo.find_by_ip(result.ip_address)
    if existing is not None:
        update_fields: dict = {"description": description, "updated_by": current_user.sub}
        if hostname:
            update_fields["hostname"] = hostname
        if existing.status.value != "Reserved":
            update_fields["status"] = "In Use"
        updated = await ip_repo.update(existing.id, update_fields)
        return PaloAltoSaveResult(
            action="updated",
            ip_record_id=existing.id,
            subnet_cidr=subnet_cidr,
            hostname=updated.hostname if updated else hostname,
            status=updated.status.value if updated else existing.status.value,
        )

    environment = "Test" if hostname and "test" in hostname.lower() else "Production"
    now = datetime.now(timezone.utc)
    created = await ip_repo.create({
        "ip_address": result.ip_address,
        "hostname": hostname,
        "os_type": "Unknown",
        "subnet_id": subnet_id,
        "vrf_id": None,
        "status": "In Use",
        "environment": environment,
        "owner": None,
        "description": description,
        "created_at": now,
        "updated_at": now,
        "created_by": current_user.sub,
        "updated_by": current_user.sub,
        "reserved_at": None,
        "reserved_by": None,
    })
    return PaloAltoSaveResult(
        action="created",
        ip_record_id=created.id,
        subnet_cidr=subnet_cidr,
        hostname=hostname,
        status="In Use",
    )


@router.post("/paloalto/save-to-records", response_model=PaloAltoSaveResult)
async def paloalto_save_to_records(
    body: PaloAltoSaveRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> PaloAltoSaveResult:
    """Re-checks the address server-side (for authoritative, fresh data —
    never trusts whatever the frontend already displayed) and commits the
    finding into IP Records."""
    try:
        ipaddress.ip_address(body.ip_address)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid IP address '{body.ip_address}'",
        ) from exc

    settings, hosts = _paloalto_settings_or_503()
    result = await PaloAltoService.check_ip(
        hosts=hosts,
        username=settings.PALOALTO_USERNAME,
        password=settings.PALOALTO_PASSWORD,
        ip=body.ip_address,
    )
    return await _save_paloalto_result(result, current_user)


@router.post("/paloalto/save-bulk", response_model=PaloAltoBulkSaveResult)
async def paloalto_save_bulk(
    body: PaloAltoBulkSaveRequest,
    current_user: UserInToken = Depends(_OPERATOR),
) -> PaloAltoBulkSaveResult:
    """Bulk version of save-to-records — re-checks every address server-side
    and commits each found one, for the PaloAlto Check page's 'Sync found
    addresses to IP Records' action after a subnet/multi-IP scan."""
    ips = [ip.strip() for ip in body.ip_addresses if ip.strip()]
    for raw in ips:
        try:
            ipaddress.ip_address(raw)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid IP address '{raw}'",
            ) from exc
    if len(ips) > MAX_BULK_IPS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Bulk save is limited to {MAX_BULK_IPS} addresses. Your request has {len(ips)}.",
        )

    settings, hosts = _paloalto_settings_or_503()
    results = await PaloAltoService.check_ips(
        hosts=hosts,
        username=settings.PALOALTO_USERNAME,
        password=settings.PALOALTO_PASSWORD,
        ips=ips,
    )

    created = updated = skipped = 0
    errors: list[str] = []
    for result in results:
        if not result.found:
            skipped += 1
            continue
        try:
            save_result = await _save_paloalto_result(result, current_user)
            if save_result.action == "created":
                created += 1
            else:
                updated += 1
        except HTTPException as exc:
            skipped += 1
            errors.append(f"{result.ip_address}: {exc.detail}")

    return PaloAltoBulkSaveResult(created=created, updated=updated, skipped=skipped, errors=errors)


def _top_scan_rules(results: list[PaloAltoCheckResult], limit: int = 10) -> list[PaloAltoRuleHit]:
    """Which security/NAT rules were actually matched by addresses in a
    subnet scan, most-referenced first. Pure post-processing of match data
    the scan already fetched — no extra PAN-OS calls."""
    counts: Counter = Counter()
    for r in results:
        for m in r.security_matches:
            counts[(m.rule_name, "security")] += 1
        for m in r.nat_matches:
            counts[(m.rule_name, "nat")] += 1
    return [
        PaloAltoRuleHit(rule_name=name, rule_type=rule_type, hit_count=count)
        for (name, rule_type), count in counts.most_common(limit)
    ]


@router.post("/paloalto/scan-subnet/{subnet_id}", response_model=PaloAltoScanSubnetResult)
async def paloalto_scan_subnet(
    subnet_id: str,
    current_user: UserInToken = Depends(_OPERATOR),
) -> PaloAltoScanSubnetResult:
    """Subnets page 'Scan in PaloAlto' — bulk-checks every host address in
    the subnet, auto-saves found addresses into IP Records (create/update,
    same rules as save-bulk), and returns fresh utilization stats.
    Subnets larger than MAX_BULK_IPS only scan the first MAX_BULK_IPS host
    addresses (noted in `errors`)."""
    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    subnet = await subnet_repo.find_by_id(subnet_id)
    if subnet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subnet not found")

    try:
        network = ipaddress.ip_network(subnet.cidr, strict=False)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Subnet has an invalid CIDR: {subnet.cidr}",
        ) from exc

    host_iter = list(network.hosts()) or list(network)
    truncated = len(host_iter) > MAX_BULK_IPS
    ips = [str(ip) for ip in host_iter[:MAX_BULK_IPS]]

    settings, hosts = _paloalto_settings_or_503()
    results = await PaloAltoService.check_ips(
        hosts=hosts,
        username=settings.PALOALTO_USERNAME,
        password=settings.PALOALTO_PASSWORD,
        ips=ips,
    )
    await PaloAltoService.log_checks_bulk(get_database(), results, "subnet-scan", current_user.sub)

    created = updated = skipped = 0
    errors: list[str] = []
    for result in results:
        if not result.found:
            skipped += 1
            continue
        try:
            save_result = await _save_paloalto_result(result, current_user)
            if save_result.action == "created":
                created += 1
            else:
                updated += 1
        except HTTPException as exc:
            skipped += 1
            errors.append(f"{result.ip_address}: {exc.detail}")

    if truncated:
        errors.append(
            f"Subnet has {len(host_iter)} host addresses — only the first "
            f"{MAX_BULK_IPS} were scanned."
        )

    status_counts = await ip_repo.count_by_subnet_and_status(subnet_id)
    used_count = status_counts.get("In Use", 0)
    total_ips = network.num_addresses
    utilization_pct = round((used_count / total_ips * 100), 1) if total_ips > 0 else 0.0

    return PaloAltoScanSubnetResult(
        subnet_cidr=subnet.cidr,
        scanned=len(ips),
        found=sum(1 for r in results if r.found),
        created=created,
        updated=updated,
        skipped=skipped,
        utilization_pct=utilization_pct,
        errors=errors,
        top_rules=_top_scan_rules(results),
    )


@router.post("/paloalto/scan-subnet-stream/{subnet_id}")
async def paloalto_scan_subnet_stream(
    subnet_id: str,
    current_user: UserInToken = Depends(_OPERATOR),
) -> StreamingResponse:
    """Streaming version of scan-subnet (Server-Sent Events) — same checks,
    same auto-save, but the trace log and each address's result arrive as
    they're produced, and a final `summary` event carries the same
    PaloAltoScanSubnetResult the non-streaming endpoint returns. Powers the
    Subnets page's 'Scan in PaloAlto' progress view."""
    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    subnet = await subnet_repo.find_by_id(subnet_id)
    if subnet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subnet not found")

    try:
        network = ipaddress.ip_network(subnet.cidr, strict=False)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Subnet has an invalid CIDR: {subnet.cidr}",
        ) from exc

    host_iter = list(network.hosts()) or list(network)
    truncated = len(host_iter) > MAX_BULK_IPS
    ips = [str(ip) for ip in host_iter[:MAX_BULK_IPS]]

    settings, hosts = _paloalto_settings_or_503()

    async def event_stream():
        results: list[PaloAltoCheckResult] = []
        try:
            async for kind, ip, payload in PaloAltoService.check_ips_streaming(
                hosts, settings.PALOALTO_USERNAME, settings.PALOALTO_PASSWORD, ips,
            ):
                if kind == "log":
                    yield f"event: log\ndata: {json.dumps({'ip': ip, 'line': payload})}\n\n"
                elif kind == "result":
                    results.append(payload)
                    yield f"event: result\ndata: {payload.model_dump_json()}\n\n"
                elif kind == "error":
                    yield f"event: error\ndata: {json.dumps({'message': payload})}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"

        if results:
            await PaloAltoService.log_checks_bulk(get_database(), results, "subnet-scan", current_user.sub)

        created = updated = skipped = 0
        errors: list[str] = []
        for result in results:
            if not result.found:
                skipped += 1
                continue
            try:
                save_result = await _save_paloalto_result(result, current_user)
                if save_result.action == "created":
                    created += 1
                else:
                    updated += 1
            except HTTPException as exc:
                skipped += 1
                errors.append(f"{result.ip_address}: {exc.detail}")

        if truncated:
            errors.append(
                f"Subnet has {len(host_iter)} host addresses — only the first "
                f"{MAX_BULK_IPS} were scanned."
            )

        status_counts = await ip_repo.count_by_subnet_and_status(subnet_id)
        used_count = status_counts.get("In Use", 0)
        total_ips = network.num_addresses
        utilization_pct = round((used_count / total_ips * 100), 1) if total_ips > 0 else 0.0

        summary = PaloAltoScanSubnetResult(
            subnet_cidr=subnet.cidr,
            scanned=len(ips),
            found=sum(1 for r in results if r.found),
            created=created,
            updated=updated,
            skipped=skipped,
            utilization_pct=utilization_pct,
            errors=errors,
            top_rules=_top_scan_rules(results),
        )
        yield f"event: summary\ndata: {summary.model_dump_json()}\n\n"
        yield "event: complete\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/paloalto/import", response_model=PaloAltoImportResult)
async def paloalto_import(
    body: PaloAltoImportRequest,
    current_user: UserInToken = Depends(_SUPERADMIN_ONLY),
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

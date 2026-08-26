import asyncio
import csv
import io
import ipaddress
import logging
import re
import subprocess
import time
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Body, Depends, File, Path, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.ip_record import Environment, IPStatus, OSType
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.ip_record_repository import IPRecordRepository
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.vrf_repository import VRFRepository
from app.schemas.audit_log import PaginatedResponse
from app.schemas.audit_log import AuditLogResponse
from app.schemas.ip_record import (
    BulkActionRequest,
    BulkUpdateRequest,
    IPRecordCreate,
    IPRecordResponse,
    IPRecordUpdate,
)
from app.services.ip_record_service import IPRecordService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ip-records", tags=["ip-records"])

_FORMULA_PREFIX_CHARS = ("=", "+", "-", "@", "\t", "\r")
_MAX_IMPORT_BYTES = 10 * 1024 * 1024  # 10 MB
_MAX_IMPORT_ROWS = 10_000
_OBJECTID_PATTERN = "^[0-9a-f]{24}$"


def _sanitize_csv_cell(value: str) -> str:
    """Prevent CSV formula injection by prefixing dangerous leading characters."""
    if value and value[0] in _FORMULA_PREFIX_CHARS:
        return "'" + value
    return value


_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator", "SuperAdmin")
_OPERATOR_PLUS = require_role("Operator", "Administrator", "SuperAdmin")
_ADMIN_ONLY = require_role("Administrator", "SuperAdmin")


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_service(db=None) -> IPRecordService:
    if db is None:
        db = get_database()
    return IPRecordService(
        ip_repo=IPRecordRepository(db["ip_records"]),
        subnet_repo=SubnetRepository(db["subnets"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
        vrf_repo=VRFRepository(db["vrfs"]),
    )


@router.get("", response_model=PaginatedResponse[IPRecordResponse])
async def list_ip_records(
    request: Request,
    pagination: PaginationParams = Depends(),
    subnet_id: Optional[str] = Query(None),
    ip_status: Optional[IPStatus] = Query(None, alias="status"),
    os_type: Optional[OSType] = Query(None),
    environment: Optional[Environment] = Query(None),
    owner: Optional[str] = Query(None),
    search: Optional[str] = Query(None, description="Full-text search on ip_address, hostname, owner, description"),
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> PaginatedResponse[IPRecordResponse]:
    filter_: dict = {}

    if subnet_id:
        filter_["subnet_id"] = subnet_id
    if ip_status:
        filter_["status"] = ip_status.value
    if os_type:
        filter_["os_type"] = os_type.value
    if environment:
        filter_["environment"] = environment.value
    if owner:
        filter_["owner"] = {"$regex": re.escape(owner), "$options": "i"}
    if search:
        escaped = re.escape(search)
        filter_["$or"] = [
            {"ip_address": {"$regex": escaped, "$options": "i"}},
            {"hostname": {"$regex": escaped, "$options": "i"}},
            {"owner": {"$regex": escaped, "$options": "i"}},
            {"description": {"$regex": escaped, "$options": "i"}},
        ]

    service = _build_service()
    records, total = await service.list_records(
        filter_=filter_,
        skip=pagination.skip,
        limit=pagination.page_size,
    )
    return PaginatedResponse.create(
        items=records,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("", response_model=IPRecordResponse, status_code=status.HTTP_201_CREATED)
async def create_ip_record(
    request: Request,
    body: IPRecordCreate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> IPRecordResponse:
    service = _build_service()
    return await service.create(
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


# ── CSV columns (order matters for export & template) ─────────────────────────
_CSV_FIELDS = [
    "ip_address", "hostname", "os_type", "subnet_cidr",
    "status", "environment", "owner", "description",
]


# IMPORTANT: /export, /export/template, /import must be defined BEFORE /{id}
@router.get("/export/template")
async def download_import_template(
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> StreamingResponse:
    """Return a ready-to-fill CSV template with two example rows."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_FIELDS)
    writer.writeheader()
    writer.writerows([
        {
            "ip_address": "192.168.1.10",
            "hostname": "server01.example.com",
            "os_type": "Linux",
            "subnet_cidr": "192.168.1.0/24",
            "status": "Free",
            "environment": "Production",
            "owner": "team-infra",
            "description": "Web server",
        },
        {
            "ip_address": "10.10.0.5",
            "hostname": "db01.example.com",
            "os_type": "AIX",
            "subnet_cidr": "10.10.0.0/24",
            "status": "In Use",
            "environment": "Production",
            "owner": "team-dba",
            "description": "Primary database",
        },
    ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ipam_import_template.csv"},
    )


@router.get("/export")
async def export_ip_records(
    request: Request,
    subnet_id: Optional[str] = Query(None),
    ip_status: Optional[IPStatus] = Query(None, alias="status"),
    os_type: Optional[OSType] = Query(None),
    environment: Optional[Environment] = Query(None),
    owner: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> StreamingResponse:
    """Export matching IP records to CSV (Operator+ only, max 5,000 records)."""
    filter_: dict = {}
    if subnet_id:
        filter_["subnet_id"] = subnet_id
    if ip_status:
        filter_["status"] = ip_status.value
    if os_type:
        filter_["os_type"] = os_type.value
    if environment:
        filter_["environment"] = environment.value
    if owner:
        filter_["owner"] = {"$regex": re.escape(owner), "$options": "i"}
    if search:
        # Same substring match (incl. ip_address) as list_ip_records, so an
        # export always matches what's currently shown on screen. $text
        # search doesn't cover ip_address and does whole-word/stemmed
        # matching, not substring — it silently produced different results.
        escaped = re.escape(search)
        filter_["$or"] = [
            {"ip_address": {"$regex": escaped, "$options": "i"}},
            {"hostname": {"$regex": escaped, "$options": "i"}},
            {"owner": {"$regex": escaped, "$options": "i"}},
            {"description": {"$regex": escaped, "$options": "i"}},
        ]

    service = _build_service()
    records, cidr_map = await service.export_records(filter_)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_FIELDS)
    writer.writeheader()
    for r in records:
        writer.writerow({
            "ip_address": r.ip_address,
            "hostname": _sanitize_csv_cell(r.hostname or ""),
            "os_type": r.os_type.value,
            "subnet_cidr": cidr_map.get(r.subnet_id, r.subnet_id),
            "status": r.status.value,
            "environment": r.environment.value,
            "owner": _sanitize_csv_cell(r.owner or ""),
            "description": _sanitize_csv_cell(r.description or ""),
        })
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ipam_export.csv"},
    )


@router.post("/import")
async def import_ip_records(
    request: Request,
    file: UploadFile = File(..., description="CSV file following the template format"),
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> dict:
    """
    Import IP records from a CSV file.
    Returns {"imported": N, "errors": [{"row": N, "ip": "...", "error": "..."}]}.
    """
    from fastapi import HTTPException as _HTTPException

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise _HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only CSV files are accepted",
        )

    content = await file.read(_MAX_IMPORT_BYTES + 1)
    if len(content) > _MAX_IMPORT_BYTES:
        raise _HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"CSV file must not exceed {_MAX_IMPORT_BYTES // (1024 * 1024)} MB",
        )

    try:
        text = content.decode("utf-8-sig")  # utf-8-sig strips BOM if present
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    if len(rows) > _MAX_IMPORT_ROWS:
        raise _HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"CSV file must not exceed {_MAX_IMPORT_ROWS} data rows",
        )

    if not rows:
        return {"imported": 0, "errors": []}

    service = _build_service()
    return await service.import_records(
        rows=rows,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


# ── History endpoint (Viewer+) — must come BEFORE /{id} routes ───────────────

@router.get("/{id}/history", response_model=list[AuditLogResponse])
async def get_ip_record_history(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> list[AuditLogResponse]:
    """Return the last 50 audit log entries for a specific IP record."""
    from app.repositories.audit_log_repository import AuditLogRepository

    db = get_database()
    audit_repo = AuditLogRepository(db["audit_logs"])
    logs, _ = await audit_repo.find_all(
        filter_={"resource_id": id},
        skip=0,
        limit=50,
        sort=[("timestamp", -1)],
    )
    return [
        AuditLogResponse(
            id=log.id,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            username=log.username,
            user_role=log.user_role,
            client_ip=log.client_ip,
            timestamp=log.timestamp,
            before=log.before,
            after=log.after,
            detail=log.detail,
        )
        for log in logs
    ]


# ── Bulk operations (Operator+) — must come BEFORE /{id} routes ──────────────

@router.post("/bulk/reserve")
async def bulk_reserve(
    request: Request,
    body: BulkActionRequest,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> dict:
    """Reserve multiple IP records by ID."""
    from app.models.audit_log import AuditAction, ResourceType

    db = get_database()
    ip_repo = IPRecordRepository(db["ip_records"])
    audit_repo = AuditLogRepository(db["audit_logs"])
    count = await ip_repo.bulk_update_status(
        body.ids, IPStatus.RESERVED, current_user.sub
    )
    for id_ in body.ids:
        await audit_repo.log(
            action=AuditAction.RESERVE,
            resource_type=ResourceType.IP_RECORD,
            username=current_user.sub,
            user_role=current_user.role.value,
            client_ip=_get_client_ip(request),
            resource_id=id_,
            detail="Bulk reserve",
        )
    return {"modified": count}


@router.post("/bulk/release")
async def bulk_release(
    request: Request,
    body: BulkActionRequest,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> dict:
    """Release multiple IP records by ID."""
    from app.models.audit_log import AuditAction, ResourceType

    db = get_database()
    ip_repo = IPRecordRepository(db["ip_records"])
    audit_repo = AuditLogRepository(db["audit_logs"])
    count = await ip_repo.bulk_update_status(
        body.ids, IPStatus.FREE, current_user.sub
    )
    for id_ in body.ids:
        await audit_repo.log(
            action=AuditAction.RELEASE,
            resource_type=ResourceType.IP_RECORD,
            username=current_user.sub,
            user_role=current_user.role.value,
            client_ip=_get_client_ip(request),
            resource_id=id_,
            detail="Bulk release",
        )
    return {"modified": count}


@router.post("/bulk/update")
async def bulk_update(
    request: Request,
    body: BulkUpdateRequest,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> dict:
    """Update environment, owner, or os_type for multiple IP records."""
    from app.models.audit_log import AuditAction, ResourceType

    db = get_database()
    ip_repo = IPRecordRepository(db["ip_records"])
    audit_repo = AuditLogRepository(db["audit_logs"])
    fields: dict = {}
    if body.environment is not None:
        fields["environment"] = body.environment.value
    if body.owner is not None:
        fields["owner"] = body.owner
    if body.os_type is not None:
        fields["os_type"] = body.os_type.value

    count = await ip_repo.bulk_update_fields(body.ids, fields, current_user.sub)
    for id_ in body.ids:
        await audit_repo.log(
            action=AuditAction.UPDATE,
            resource_type=ResourceType.IP_RECORD,
            username=current_user.sub,
            user_role=current_user.role.value,
            client_ip=_get_client_ip(request),
            resource_id=id_,
            after=fields,
            detail="Bulk update",
        )
    return {"modified": count}


# IMPORTANT: /by-ip/{ip_address} must be defined BEFORE /{id} to avoid route shadowing
@router.get("/by-ip/{ip_address}", response_model=IPRecordResponse)
async def get_ip_record_by_ip(
    ip_address: str,
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> IPRecordResponse:
    service = _build_service()
    return await service.get_by_ip(ip_address)


@router.get("/{id}", response_model=IPRecordResponse)
async def get_ip_record(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> IPRecordResponse:
    service = _build_service()
    return await service.get_by_id(id)


@router.put("/{id}", response_model=IPRecordResponse)
async def update_ip_record(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: IPRecordUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> IPRecordResponse:
    service = _build_service()
    return await service.update(
        id=id,
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.patch("/{id}", response_model=IPRecordResponse)
async def patch_ip_record(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    body: IPRecordUpdate,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> IPRecordResponse:
    service = _build_service()
    return await service.update(
        id=id,
        data=body,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ip_record(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> None:
    service = _build_service()
    await service.delete(
        id=id,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.post("/{id}/reserve", response_model=IPRecordResponse)
async def reserve_ip_record(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> IPRecordResponse:
    service = _build_service()
    return await service.reserve(
        id=id,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


@router.post("/{id}/release", response_model=IPRecordResponse)
async def release_ip_record(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> IPRecordResponse:
    service = _build_service()
    return await service.release(
        id=id,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
    )


# ── Ping / availability check ─────────────────────────────────────────────────

# Broad port list: covers Linux, Windows, network devices, databases, web
_PROBE_PORTS = [
    22, 23, 25, 53, 80, 110, 135, 139, 143,
    443, 445, 3306, 3389, 5432, 8080, 8443, 8888,
]
_PROBE_TIMEOUT = 0.8


class PingResult(BaseModel):
    ip_address: str
    reachable: bool
    method: str
    latency_ms: Optional[float] = None
    status_updated: bool = False
    new_status: Optional[str] = None
    scan_source: Optional[str] = None
    device_name: Optional[str] = None


# Real, currently-mounted host NICs the scan helper can bind to, plus
# "device42" (real-time inventory lookup). "paloalto" is accepted here but
# always rejected below — the UI shows it disabled until it gets its own
# reachability check.
_VALID_SCAN_SOURCES = {"ens192", "ens224", "device42", "zabbix", "paloalto"}
_HOST_NIC_SOURCES = {"ens192", "ens224"}


async def _helper_ping(source: str, target_ip: str) -> tuple[bool, Optional[float]]:
    """Delegates the actual ping to the host-side scan helper (systemd
    service outside the container) so it goes out the real ens192/ens224
    interface instead of the container's own bridge/NAT path."""
    import httpx

    from app.config import get_settings

    settings = get_settings()
    url = getattr(settings, "SCAN_HELPER_URL", None)
    token = getattr(settings, "SCAN_HELPER_TOKEN", None)
    if not url:
        raise RuntimeError("Scan helper not configured (SCAN_HELPER_URL missing)")

    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(
            url,
            json={"source": source, "target": target_ip},
            headers={"X-Scan-Token": token} if token else {},
        )
        resp.raise_for_status()
        data = resp.json()
        return bool(data.get("reachable")), data.get("latency_ms")


async def _device42_lookup(target_ip: str) -> tuple[bool, Optional[str]]:
    """Real-time Device42 inventory lookup for one IP. Not a network probe —
    reflects whatever Device42 currently has on record for this address.
    Returns (in_use, device_name)."""
    import httpx

    from app.config import get_settings

    settings = get_settings()
    host = getattr(settings, "DEVICE42_HOST", None)
    username = getattr(settings, "DEVICE42_USERNAME", None)
    password = getattr(settings, "DEVICE42_PASSWORD", None)
    if not host or not username:
        raise RuntimeError("Device42 not configured (DEVICE42_HOST/USERNAME missing)")

    async with httpx.AsyncClient(
        auth=(username, password), verify=False, timeout=10.0, follow_redirects=True
    ) as client:
        resp = await client.get(f"{host}/api/1.0/ips/", params={"ip": target_ip})
        resp.raise_for_status()
        data = resp.json()
        entries = data.get("ips", [])
        if not entries:
            return False, None
        entry = entries[0]
        device_name = entry.get("device")
        # An entry can exist purely as a registered-but-unassigned address
        # within a known subnet (available="yes", no device) — that's free,
        # not in use, even though Device42 has a record for it.
        in_use = bool(device_name) and (entry.get("available") or "no").lower() != "yes"
        return in_use, device_name if in_use else None


async def _zabbix_lookup(target_ip: str) -> tuple[bool, Optional[str]]:
    """Real-time Zabbix monitoring lookup for one IP. Unlike Device42 (a
    static inventory), Zabbix actively polls its hosts — 'reachable' here
    reflects Zabbix's own live availability state, not just presence in
    inventory. Returns (reachable, device_name)."""
    from app.config import get_settings
    from app.services.zabbix_service import ZabbixService

    settings = get_settings()
    host = getattr(settings, "ZABBIX_HOST", None)
    token = getattr(settings, "ZABBIX_TOKEN", None)
    if not host or not token:
        raise RuntimeError("Zabbix not configured (ZABBIX_HOST/ZABBIX_TOKEN missing)")

    return await ZabbixService.lookup_ip(host=host, token=token, target_ip=target_ip)


async def _tcp_probe(ip: str, port: int, timeout: float) -> bool:
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port),
            timeout=timeout,
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


def _icmp_ping(ip: str) -> Optional[float]:
    """ICMP ping via subprocess (requires iputils-ping in container)."""
    try:
        start = time.monotonic()
        result = subprocess.run(
            ["ping", "-c", "1", "-W", "2", ip],
            capture_output=True,
            timeout=5,
        )
        if result.returncode == 0:
            return round((time.monotonic() - start) * 1000, 1)
    except FileNotFoundError:
        pass  # ping binary not available
    except Exception:
        pass
    return None


def _icmp_ping_raw(ip: str) -> Optional[float]:
    """
    ICMP echo via raw socket (requires CAP_NET_RAW).
    Falls back gracefully if not permitted.
    """
    import os
    import select
    import socket as _socket
    import struct

    ICMP_ECHO = 8
    try:
        sock = _socket.socket(_socket.AF_INET, _socket.SOCK_RAW, _socket.IPPROTO_ICMP)
        sock.settimeout(2.0)
    except PermissionError:
        return None

    try:
        # Build minimal ICMP echo request
        pid = os.getpid() & 0xFFFF
        header = struct.pack("bbHHh", ICMP_ECHO, 0, 0, pid, 1)
        data = b"ping"
        chk = 0
        for i in range(0, len(header + data), 2):
            word = ((header + data)[i] << 8) + (header + data)[i + 1]
            chk += word
        chk = (chk >> 16) + (chk & 0xFFFF)
        chk = ~chk & 0xFFFF
        header = struct.pack("bbHHh", ICMP_ECHO, 0, _socket.htons(chk), pid, 1)

        start = time.monotonic()
        sock.sendto(header + data, (ip, 0))
        readable, _, _ = select.select([sock], [], [], 2.0)
        if readable:
            return round((time.monotonic() - start) * 1000, 1)
    except Exception:
        pass
    finally:
        sock.close()
    return None


async def _apply_ping_status(
    record, reachable: bool, id: str, current_user: UserInToken, request: Request, auto_update: bool
) -> tuple[bool, Optional[str]]:
    """Shared by every ping strategy: if auto_update, flips In Use <-> Free
    based on the check result and writes an audit log entry."""
    from app.models.audit_log import AuditAction, ResourceType

    if not auto_update:
        return False, None

    target_status = "In Use" if reachable else "Free"
    if record.status.value == target_status:
        return False, None

    # Reserved is a manual, intentional hold — an address not yet turned on
    # is expected to not respond, so a failed check is not evidence the
    # reservation should be released. Only let a *reachable* result upgrade
    # Reserved -> In Use; never let an unreachable one downgrade it to Free.
    if record.status.value == "Reserved" and target_status == "Free":
        return False, None

    db = get_database()
    ip_repo = IPRecordRepository(db["ip_records"])
    audit_repo = AuditLogRepository(db["audit_logs"])
    await ip_repo.update(id, {"status": target_status, "updated_by": current_user.sub})
    detail_msg = (
        "Auto-updated to In Use: IP responded to availability check"
        if reachable
        else "Auto-updated to Free: IP did not respond to availability check"
    )
    await audit_repo.log(
        action=AuditAction.UPDATE,
        resource_type=ResourceType.IP_RECORD,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
        resource_id=id,
        before={"status": record.status.value},
        after={"status": target_status},
        detail=detail_msg,
    )
    return True, target_status


@router.post("/{id}/ping", response_model=PingResult)
async def ping_ip_record(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    auto_update: bool = Body(default=True, embed=True),
    scan_source: Optional[str] = Body(default=None, embed=True),
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> PingResult:
    """
    Check whether the IP address is reachable.
    If not reachable and auto_update=true, set status to Free (Available).

    scan_source picks which real network path / source of truth performs
    the check:
    - None (default): existing in-container check (subprocess ping -> raw
      ICMP -> TCP probe), same as before this field existed.
    - "ens192" / "ens224": delegates to the host-side scan helper so the
      ping actually leaves via that real interface's own address.
    - "device42": real-time Device42 inventory lookup (not a network probe)
      — reports which device the IP is assigned to, or that it's free.
    - "paloalto": not implemented yet — the UI shows it disabled; rejected
      here too in case it's ever sent directly.
    """
    if scan_source is not None and scan_source not in _VALID_SCAN_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown scan_source '{scan_source}'",
        )
    if scan_source == "paloalto":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Scanning via {scan_source} is not integrated yet",
        )

    service = _build_service()
    record = await service.get_by_id(id)
    ip = record.ip_address

    reachable = False
    latency_ms: Optional[float] = None
    method = "tcp"

    if scan_source in _HOST_NIC_SOURCES:
        try:
            reachable, latency_ms = await _helper_ping(scan_source, ip)
            method = "icmp"
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Scan helper unreachable: {exc}",
            ) from exc
        status_updated, new_status = await _apply_ping_status(
            record, reachable, id, current_user, request, auto_update
        )
        return PingResult(
            ip_address=ip,
            reachable=reachable,
            method=method,
            latency_ms=latency_ms,
            status_updated=status_updated,
            new_status=new_status,
            scan_source=scan_source,
        )

    if scan_source == "device42":
        try:
            in_use, device_name = await _device42_lookup(ip)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Device42 lookup failed: {exc}",
            ) from exc
        # Asymmetric on purpose: Device42 finding a device assigned to this
        # IP is strong positive evidence, safe to auto-mark In Use. Device42
        # having NO record is weak evidence at best — Device42's inventory
        # is not guaranteed complete (e.g. assets imported from elsewhere,
        # like hosts.txt imports, that were never entered into Device42) —
        # so a miss here must never auto-flip an existing record to Free.
        status_updated, new_status = await _apply_ping_status(
            record, in_use, id, current_user, request, auto_update and in_use
        )
        return PingResult(
            ip_address=ip,
            reachable=in_use,
            method="device42",
            latency_ms=None,
            status_updated=status_updated,
            new_status=new_status,
            scan_source=scan_source,
            device_name=device_name,
        )

    if scan_source == "zabbix":
        try:
            reachable, device_name = await _zabbix_lookup(ip)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Zabbix lookup failed: {exc}",
            ) from exc
        # Same asymmetric rule as Device42, for the same reason: Zabbix
        # reporting a host reachable is strong positive evidence, but a host
        # missing from Zabbix (or currently down) is not proof the address
        # is unused — never auto-flip to Free from this signal alone.
        status_updated, new_status = await _apply_ping_status(
            record, reachable, id, current_user, request, auto_update and reachable
        )
        return PingResult(
            ip_address=ip,
            reachable=reachable,
            method="zabbix",
            latency_ms=None,
            status_updated=status_updated,
            new_status=new_status,
            scan_source=scan_source,
            device_name=device_name,
        )

    loop = asyncio.get_running_loop()

    # Strategy 1: subprocess ping (iputils-ping installed in container)
    icmp_latency = await loop.run_in_executor(None, _icmp_ping, ip)
    if icmp_latency is not None:
        reachable = True
        latency_ms = icmp_latency
        method = "icmp"

    # Strategy 2: raw ICMP socket (requires CAP_NET_RAW)
    if not reachable:
        raw_latency = await loop.run_in_executor(None, _icmp_ping_raw, ip)
        if raw_latency is not None:
            reachable = True
            latency_ms = raw_latency
            method = "icmp-raw"

    # Strategy 3: TCP connect to common ports in parallel
    if not reachable:
        start = time.monotonic()
        tasks = [_tcp_probe(ip, p, _PROBE_TIMEOUT) for p in _PROBE_PORTS]
        results = await asyncio.gather(*tasks)
        if any(results):
            reachable = True
            latency_ms = round((time.monotonic() - start) * 1000, 1)
            method = "tcp"

    status_updated, new_status = await _apply_ping_status(
        record, reachable, id, current_user, request, auto_update
    )

    return PingResult(
        ip_address=ip,
        reachable=reachable,
        method=method,
        latency_ms=latency_ms,
        status_updated=status_updated,
        new_status=new_status,
        scan_source=scan_source,
    )


@router.post("/check-ip", response_model=PingResult)
async def check_ip_availability(
    ip_address: str = Body(..., embed=True),
    scan_source: Optional[str] = Body(default=None, embed=True),
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> PingResult:
    """Same availability check as /{id}/ping, but for an address that has no
    IP record yet (e.g. an entry from the Unused IPs list) — nothing to
    update, this is purely informational."""
    try:
        ipaddress.ip_address(ip_address)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid IP address '{ip_address}'",
        ) from exc

    if scan_source is not None and scan_source not in _VALID_SCAN_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown scan_source '{scan_source}'",
        )
    if scan_source == "paloalto":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Scanning via {scan_source} is not integrated yet",
        )

    if scan_source in _HOST_NIC_SOURCES:
        try:
            reachable, latency_ms = await _helper_ping(scan_source, ip_address)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Scan helper unreachable: {exc}",
            ) from exc
        return PingResult(
            ip_address=ip_address,
            reachable=reachable,
            method="icmp",
            latency_ms=latency_ms,
            scan_source=scan_source,
        )

    if scan_source == "device42":
        try:
            in_use, device_name = await _device42_lookup(ip_address)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Device42 lookup failed: {exc}",
            ) from exc
        return PingResult(
            ip_address=ip_address,
            reachable=in_use,
            method="device42",
            latency_ms=None,
            scan_source=scan_source,
            device_name=device_name,
        )

    if scan_source == "zabbix":
        try:
            reachable, device_name = await _zabbix_lookup(ip_address)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Zabbix lookup failed: {exc}",
            ) from exc
        return PingResult(
            ip_address=ip_address,
            reachable=reachable,
            method="zabbix",
            latency_ms=None,
            scan_source=scan_source,
            device_name=device_name,
        )

    loop = asyncio.get_running_loop()
    reachable = False
    latency_ms = None
    method = "tcp"

    icmp_latency = await loop.run_in_executor(None, _icmp_ping, ip_address)
    if icmp_latency is not None:
        reachable = True
        latency_ms = icmp_latency
        method = "icmp"

    if not reachable:
        raw_latency = await loop.run_in_executor(None, _icmp_ping_raw, ip_address)
        if raw_latency is not None:
            reachable = True
            latency_ms = raw_latency
            method = "icmp-raw"

    if not reachable:
        start = time.monotonic()
        tasks = [_tcp_probe(ip_address, p, _PROBE_TIMEOUT) for p in _PROBE_PORTS]
        results = await asyncio.gather(*tasks)
        if any(results):
            reachable = True
            latency_ms = round((time.monotonic() - start) * 1000, 1)
            method = "tcp"

    return PingResult(
        ip_address=ip_address,
        reachable=reachable,
        method=method,
        latency_ms=latency_ms,
        scan_source=scan_source,
    )

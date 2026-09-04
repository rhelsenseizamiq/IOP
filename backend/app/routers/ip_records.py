import asyncio
import csv
import io
import ipaddress
import json
import logging
import re
import subprocess
import time
from typing import Annotated, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    HTTPException,
    Path,
    Query,
    Request,
    UploadFile,
    status,
)
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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> dict:
    """
    Import IP records from a CSV file.
    Returns {"imported": N, "errors": [{"row": N, "ip": "...", "error": "..."}]}.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only CSV files are accepted",
        )

    content = await file.read(_MAX_IMPORT_BYTES + 1)
    if len(content) > _MAX_IMPORT_BYTES:
        raise HTTPException(
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
        raise HTTPException(
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


_MAX_DUPLICATE_GROUPS = 100
_MAX_RECORDS_PER_GROUP = 100


@router.get("/duplicates")
async def find_duplicate_ip_records(
    current_user: UserInToken = Depends(_OPERATOR_PLUS),
) -> dict:
    """Read-only duplicate finder for the IP Records toolbar. Duplicate IP
    addresses should be structurally impossible (unique compound index on
    vrf_id+ip_address in mongodb/init.js) — this checks anyway as a data
    integrity net. Duplicate hostnames have no such constraint and are the
    genuinely useful case (e.g. a stale record left behind when a host was
    decommissioned and its address reassigned under a new record)."""
    db = get_database()
    col = db["ip_records"]

    async def _dupe_groups(field: str) -> list[dict]:
        pipeline = [
            {"$match": {field: {"$nin": [None, ""]}}},
            {"$group": {
                "_id": f"${field}",
                "count": {"$sum": 1},
                "records": {"$push": {
                    "id": {"$toString": "$_id"},
                    "ip_address": "$ip_address",
                    "hostname": "$hostname",
                    "status": "$status",
                }},
            }},
            {"$match": {"count": {"$gt": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": _MAX_DUPLICATE_GROUPS},
        ]
        groups = []
        async for doc in col.aggregate(pipeline):
            groups.append({
                "value": doc["_id"],
                "count": doc["count"],
                "records": doc["records"][:_MAX_RECORDS_PER_GROUP],
            })
        return groups

    return {
        "duplicate_ips": await _dupe_groups("ip_address"),
        "duplicate_hostnames": await _dupe_groups("hostname"),
    }


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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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


# Real, currently-mounted host NICs the scan helper can bind to, plus the
# four real-time inventory lookups (Device42, Zabbix, PaloAlto, vSphere).
_VALID_SCAN_SOURCES = {"ens192", "ens224", "device42", "zabbix", "paloalto", "vsphere"}
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


async def _device42_lookup(target_ip: str) -> tuple[bool, Optional[str], Optional[str]]:
    """Real-time Device42 inventory lookup for one IP. Not a network probe —
    reflects whatever Device42 currently has on record for this address.
    Returns (in_use, device_name, os_type). os_type is a best-effort single
    extra lookup against the matched device's own record — never fails the
    whole check if it errors, since OS enrichment is a bonus, not the point."""
    import httpx

    from app.config import get_settings
    from app.services.device42_service import _map_os

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
            return False, None, None
        entry = entries[0]
        device_name = entry.get("device")
        # An entry can exist purely as a registered-but-unassigned address
        # within a known subnet (available="yes", no device) — that's free,
        # not in use, even though Device42 has a record for it.
        in_use = bool(device_name) and (entry.get("available") or "no").lower() != "yes"
        if not in_use:
            return False, None, None

        os_type = None
        try:
            dev_resp = await client.get(f"{host}/api/1.0/devices/name/{device_name}/")
            dev_resp.raise_for_status()
            mapped = _map_os(dev_resp.json().get("os"))
            os_type = mapped if mapped != "Unknown" else None
        except Exception:
            pass  # best-effort — a failed OS lookup shouldn't fail the in-use check

        return True, device_name, os_type


async def _zabbix_lookup(target_ip: str) -> tuple[bool, Optional[str], Optional[str]]:
    """Real-time Zabbix monitoring lookup for one IP. Unlike Device42 (a
    static inventory), Zabbix actively polls its hosts — 'reachable' here
    reflects Zabbix's own live availability state, not just presence in
    inventory. Returns (reachable, device_name, os_type)."""
    from app.config import get_settings
    from app.services.zabbix_service import ZabbixService

    settings = get_settings()
    host = getattr(settings, "ZABBIX_HOST", None)
    token = getattr(settings, "ZABBIX_TOKEN", None)
    if not host or not token:
        raise RuntimeError("Zabbix not configured (ZABBIX_HOST/ZABBIX_TOKEN missing)")

    return await ZabbixService.lookup_ip(host=host, token=token, target_ip=target_ip)


async def _vsphere_lookup(target_ip: str) -> tuple[bool, Optional[str], Optional[str], Optional[str]]:
    """Real-time vCenter inventory lookup for one IP, across every
    configured vCenter (checked concurrently, same as PaloAlto's multi-host
    pattern). Returns (found, guest_hostname, os_type, power_state) from
    the first vCenter that reports a match. guest_hostname is the DNS name
    VMware Tools reports inside the guest — see _apply_combined_check for
    how it can enrich the IP record's hostname field. power_state ("on" /
    "off") lets the caller distinguish a VM that exists but is shut down
    from not being found at all, instead of collapsing both into False."""
    from app.config import get_settings
    from app.services.vsphere_service import VsphereService

    settings = get_settings()
    hosts = [h.strip() for h in (settings.VCENTER_HOSTS or "").split(",") if h.strip()]
    if not hosts or not settings.VCENTER_USERNAME:
        raise RuntimeError("vSphere not configured (VCENTER_HOSTS/VCENTER_USERNAME missing)")

    results = await asyncio.gather(
        *(
            VsphereService.lookup_ip(
                host=host,
                username=settings.VCENTER_USERNAME,
                password=settings.VCENTER_PASSWORD,
                target_ip=target_ip,
                verify_ssl=settings.VCENTER_VERIFY_SSL,
            )
            for host in hosts
        ),
        return_exceptions=True,
    )

    errors: list[str] = []
    for host, result in zip(hosts, results):
        if isinstance(result, Exception):
            errors.append(f"{host}: {result}")
            continue
        found, hostname, os_type, power_state = result
        if found:
            return True, hostname, os_type, power_state

    if errors and len(errors) == len(hosts):
        raise RuntimeError("; ".join(errors))
    return False, None, None, None


def _vsphere_display_name(name: Optional[str], power_state: Optional[str]) -> Optional[str]:
    """Annotates a vSphere match's progress-event label with its power
    state, explicit either way, so the UI shows 'Found — mail01 (running)'
    or 'Found — mail01 (powered off)' instead of implying a bare "Found"
    means the VM is live on the network."""
    if not name and power_state is None:
        return None
    label = name or "unknown"
    if power_state == "off":
        return f"{label} (powered off)"
    if power_state == "on":
        return f"{label} (running)"
    return label


async def _paloalto_full_check(target_ip: str, current_user: UserInToken, source: str):
    """Runs a full PaloAltoService check and persists it to the 30-day
    check-log history (paloalto_check_logs). Shared by every PaloAlto
    entry point on this router so history stays complete regardless of
    which UI action triggered the check."""
    from app.config import get_settings
    from app.services.paloalto_service import PaloAltoService

    settings = get_settings()
    hosts = [h.strip() for h in (settings.PALOALTO_HOSTS or "").split(",") if h.strip()]
    if not hosts or not settings.PALOALTO_USERNAME:
        raise RuntimeError("PaloAlto not configured (PALOALTO_HOSTS/PALOALTO_USERNAME missing)")

    result = await PaloAltoService.check_ip(
        hosts=hosts,
        username=settings.PALOALTO_USERNAME,
        password=settings.PALOALTO_PASSWORD,
        ip=target_ip,
    )
    await PaloAltoService.log_check(get_database(), result, source, current_user.sub)
    return result


def _paloalto_device_label(result) -> Optional[str]:
    """Best available human label for a found result — preferred over a
    bare True/False so the Check Availability notification can say what
    it actually found."""
    if not result.found:
        return None
    if result.matches:
        match = result.matches[0]
        return match.address_name or f"seen on {match.host}"
    if result.nat_matches:
        nat = result.nat_matches[0]
        return f"NAT rule '{nat.rule_name}' on {nat.host}"
    sec = result.security_matches[0]
    return f"security rule '{sec.rule_name}' on {sec.host}"


async def _paloalto_lookup(
    target_ip: str, current_user: UserInToken, source: str = "check-availability",
) -> tuple[bool, Optional[str]]:
    """Real-time PaloAlto lookup for one IP, across every configured
    firewall — a named address object, a live ARP entry, a NAT rule, or a
    security policy reference all count as positive evidence. Returns
    (in_use, device_name)."""
    result = await _paloalto_full_check(target_ip, current_user, source)
    return result.found, _paloalto_device_label(result)


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


async def _apply_paloalto_enrichment(
    record, result, id: str, current_user: UserInToken, request: Request, auto_update: bool,
) -> tuple[bool, Optional[str]]:
    """PaloAlto-specific version of _apply_ping_status: when found and
    auto_update, this is a full data refresh, not just a status flip —
    hostname and description are enriched from the check result too, so
    running 'Check Availability via PaloAlto' from IP Records actually
    updates what's on file, not just In Use/Free. Same guard rails as
    every other source: Reserved is never auto-downgraded, and a miss is
    never treated as proof of Free."""
    from app.models.audit_log import AuditAction, ResourceType

    if not auto_update or not result.found:
        return False, None

    hostname = result.hostname or (result.matches[0].address_name if result.matches else None)
    reasons = []
    if result.matches:
        reasons.append("address object/ARP")
    if result.nat_matches:
        reasons.append(f"{len(result.nat_matches)} NAT rule(s)")
    if result.security_matches_total:
        reasons.append(f"{result.security_matches_total} security rule(s)")
    description = f"PaloAlto Check: {', '.join(reasons)}" if reasons else None

    update_fields: dict = {"updated_by": current_user.sub}
    if hostname and hostname != record.hostname:
        update_fields["hostname"] = hostname
    if description and description != record.description:
        update_fields["description"] = description

    target_status = "In Use"
    status_changed = record.status.value not in ("Reserved", target_status)
    if status_changed:
        update_fields["status"] = target_status

    if len(update_fields) <= 1:  # nothing but updated_by — no real change
        return False, None

    db = get_database()
    ip_repo = IPRecordRepository(db["ip_records"])
    audit_repo = AuditLogRepository(db["audit_logs"])
    await ip_repo.update(id, update_fields)
    await audit_repo.log(
        action=AuditAction.UPDATE,
        resource_type=ResourceType.IP_RECORD,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
        resource_id=id,
        before={
            "status": record.status.value,
            "hostname": record.hostname,
            "description": record.description,
        },
        after={k: v for k, v in update_fields.items() if k != "updated_by"},
        detail=f"Auto-updated from PaloAlto Check: {', '.join(reasons)}",
    )
    return status_changed, (target_status if status_changed else None)


async def _apply_combined_check(
    record,
    id: str,
    current_user: UserInToken,
    request: Request,
    device42_found: bool,
    device42_name: Optional[str],
    device42_os: Optional[str],
    zabbix_found: bool,
    zabbix_name: Optional[str],
    zabbix_os: Optional[str],
    paloalto_result,
    vsphere_found: bool,
    vsphere_name: Optional[str],
    vsphere_os: Optional[str],
    vsphere_power_state: Optional[str],
    auto_update: bool,
) -> tuple[bool, Optional[str], Optional[str], Optional[str]]:
    """Merged Check Availability: combines Device42 + Zabbix + PaloAlto +
    vSphere findings into ONE update instead of four separate ones. Any
    positive finding can upgrade the record to In Use; nothing here ever
    auto-downgrades to Free (absence of evidence isn't evidence of
    absence) and Reserved is never auto-released — same asymmetric rule as
    every individual source. The one exception: a vSphere match on a
    POWERED-OFF VM is real evidence the address exists in inventory, but
    not evidence it's currently in use on the network, so on its own it
    does NOT count toward any_found/the status flip — it's still listed
    in the description (annotated "powered off") for visibility whenever
    something else did trigger an update. Hostname prefers PaloAlto's data
    (an address object/NAT/security-rule name) when it has one; vSphere's
    guest DNS name (what VMware Tools reports inside the guest — a
    genuinely authoritative source, since it comes straight from the OS)
    fills in whenever PaloAlto didn't provide a name, powered off or not.
    OS type prefers Device42 (the canonical inventory), then Zabbix, then
    vSphere (a best-effort guess from guestFullName, least authoritative);
    the description always summarizes which source(s) actually found it,
    for transparency. Returns (status_updated, new_status,
    hostname_applied, os_type_applied)."""
    from app.models.audit_log import AuditAction, ResourceType

    paloalto_found = bool(paloalto_result and paloalto_result.found)
    vsphere_powered_on = vsphere_found and vsphere_power_state != "off"
    any_found = device42_found or zabbix_found or paloalto_found or vsphere_powered_on

    if not auto_update or not any_found:
        return False, None, None, None

    sources = []
    if device42_found:
        sources.append(f"Device42 ({device42_name or 'unknown'})")
    if zabbix_found:
        sources.append(f"Zabbix ({zabbix_name or 'unknown'})")
    if paloalto_found:
        sources.append("PaloAlto")
    if vsphere_found:
        vsphere_label = vsphere_name or "unknown"
        if vsphere_power_state == "off":
            vsphere_label += " — powered off"
        sources.append(f"vSphere ({vsphere_label})")
    description = f"Check Availability: found via {', '.join(sources)}"

    hostname = None
    if paloalto_found:
        hostname = paloalto_result.hostname or (
            paloalto_result.matches[0].address_name if paloalto_result.matches else None
        )
    if not hostname and vsphere_found and vsphere_name:
        hostname = vsphere_name

    os_type = device42_os or zabbix_os or vsphere_os

    update_fields: dict = {"updated_by": current_user.sub, "description": description}
    if hostname and hostname != record.hostname:
        update_fields["hostname"] = hostname
    if os_type and os_type != record.os_type.value:
        update_fields["os_type"] = os_type
    if vsphere_found and vsphere_power_state and vsphere_power_state != record.power_state:
        update_fields["power_state"] = vsphere_power_state

    target_status = "In Use"
    status_changed = record.status.value not in ("Reserved", target_status)
    if status_changed:
        update_fields["status"] = target_status

    db = get_database()
    ip_repo = IPRecordRepository(db["ip_records"])
    audit_repo = AuditLogRepository(db["audit_logs"])
    await ip_repo.update(id, update_fields)
    await audit_repo.log(
        action=AuditAction.UPDATE,
        resource_type=ResourceType.IP_RECORD,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=_get_client_ip(request),
        resource_id=id,
        before={
            "status": record.status.value,
            "hostname": record.hostname,
            "os_type": record.os_type.value,
            "power_state": record.power_state,
            "description": record.description,
        },
        after={k: v for k, v in update_fields.items() if k != "updated_by"},
        detail=f"Auto-updated from combined Check Availability: {', '.join(sources)}",
    )
    return (
        status_changed,
        (target_status if status_changed else None),
        update_fields.get("hostname"),
        update_fields.get("os_type"),
    )


async def _combined_check_events(
    record,
    id: str,
    current_user: UserInToken,
    request: Request,
    auto_update: bool,
    result_holder: Optional[dict] = None,
):
    """Shared SSE generator: scans Device42, then Zabbix, then PaloAlto, then
    vSphere in sequence for one existing IP record, then applies
    _apply_combined_check. Yields 'progress' events per source, then either
    an 'error' event (and stops) or a final 'result' event. Does NOT yield
    'complete' — the caller owns the stream's lifecycle, since a bulk
    caller needs to run this once per record before emitting its own
    summary+complete.
    If result_holder is given, it's populated in place with the final result
    dict on success (left empty on error) so a bulk caller can tally
    outcomes without re-parsing the SSE text."""
    device42_found = zabbix_found = vsphere_found = False
    device42_name = zabbix_name = vsphere_name = None
    device42_os = zabbix_os = vsphere_os = None
    vsphere_power_state = None
    paloalto_result = None
    ip = record.ip_address

    yield f"event: progress\ndata: {json.dumps({'source': 'device42', 'status': 'checking'})}\n\n"
    try:
        device42_found, device42_name, device42_os = await _device42_lookup(ip)
        yield f"event: progress\ndata: {json.dumps({'source': 'device42', 'status': 'done', 'found': device42_found, 'name': device42_name})}\n\n"
    except Exception as exc:
        yield f"event: progress\ndata: {json.dumps({'source': 'device42', 'status': 'error', 'message': str(exc)})}\n\n"

    yield f"event: progress\ndata: {json.dumps({'source': 'zabbix', 'status': 'checking'})}\n\n"
    try:
        zabbix_found, zabbix_name, zabbix_os = await _zabbix_lookup(ip)
        yield f"event: progress\ndata: {json.dumps({'source': 'zabbix', 'status': 'done', 'found': zabbix_found, 'name': zabbix_name})}\n\n"
    except Exception as exc:
        yield f"event: progress\ndata: {json.dumps({'source': 'zabbix', 'status': 'error', 'message': str(exc)})}\n\n"

    yield f"event: progress\ndata: {json.dumps({'source': 'paloalto', 'status': 'checking'})}\n\n"
    try:
        paloalto_result = await _paloalto_full_check(ip, current_user, "check-availability")
        yield (
            f"event: progress\ndata: "
            f"{json.dumps({'source': 'paloalto', 'status': 'done', 'found': paloalto_result.found, 'name': _paloalto_device_label(paloalto_result)})}"
            f"\n\n"
        )
    except Exception as exc:
        yield f"event: progress\ndata: {json.dumps({'source': 'paloalto', 'status': 'error', 'message': str(exc)})}\n\n"

    yield f"event: progress\ndata: {json.dumps({'source': 'vsphere', 'status': 'checking'})}\n\n"
    try:
        vsphere_found, vsphere_name, vsphere_os, vsphere_power_state = await _vsphere_lookup(ip)
        yield (
            f"event: progress\ndata: "
            f"{json.dumps({'source': 'vsphere', 'status': 'done', 'found': vsphere_found, 'name': _vsphere_display_name(vsphere_name, vsphere_power_state)})}"
            f"\n\n"
        )
    except Exception as exc:
        yield f"event: progress\ndata: {json.dumps({'source': 'vsphere', 'status': 'error', 'message': str(exc)})}\n\n"

    try:
        status_updated, new_status, hostname, os_type = await _apply_combined_check(
            record, id, current_user, request,
            device42_found, device42_name, device42_os,
            zabbix_found, zabbix_name, zabbix_os,
            paloalto_result,
            vsphere_found, vsphere_name, vsphere_os, vsphere_power_state,
            auto_update,
        )
    except Exception as exc:
        yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
        return

    vsphere_powered_on = vsphere_found and vsphere_power_state != "off"
    found = device42_found or zabbix_found or vsphere_powered_on or bool(paloalto_result and paloalto_result.found)
    result = {
        "ip_address": ip, "found": found, "status_updated": status_updated,
        "new_status": new_status, "hostname": hostname, "os_type": os_type,
        "device42_found": device42_found, "zabbix_found": zabbix_found,
        "paloalto_found": bool(paloalto_result and paloalto_result.found),
        "vsphere_found": vsphere_found,
        "vsphere_power_state": vsphere_power_state,
    }
    if result_holder is not None:
        result_holder.update(result)
    yield f"event: result\ndata: {json.dumps(result)}\n\n"


_MAX_BULK_SCAN_IDS = 200


@router.post("/bulk/check-availability-stream")
async def bulk_check_availability_stream(
    request: Request,
    ids: list[str] = Body(..., embed=True),
    auto_update: bool = Body(default=True, embed=True),
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> StreamingResponse:
    """Bulk Check Availability — runs the same Device42 → Zabbix → PaloAlto →
    vSphere merged scan (_combined_check_events) sequentially over a list of
    existing IP records, applying the same asymmetric auto-update rule to
    each independently. Powers 'Bulk Scan' from the Duplicates and Stale
    In-Use Records dashboard panels. A failure on one record (e.g. it was
    deleted since the list was loaded) is reported via 'record-error' and
    skipped — it never aborts the rest of the batch.
    NOTE: must be registered BEFORE /{id}/check-availability-stream — both
    are 2-segment paths ('/bulk/...' vs '/{id}/...') and FastAPI/Starlette
    tries route templates in registration order, validating path params
    (the {id} hex-pattern) before falling through to the next template. If
    this came after, a request to /bulk/... would match {id}='bulk' first,
    fail the pattern check, and 422 instead of ever reaching this route."""
    if not ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No IDs provided")
    ids = ids[:_MAX_BULK_SCAN_IDS]

    service = _build_service()
    total = len(ids)

    async def event_stream():
        scanned = found_count = updated_count = 0
        errors: list[str] = []

        for index, rec_id in enumerate(ids):
            try:
                record = await service.get_by_id(rec_id)
            except HTTPException as exc:
                errors.append(f"{rec_id}: {exc.detail}")
                yield f"event: record-error\ndata: {json.dumps({'index': index, 'total': total, 'id': rec_id, 'message': exc.detail})}\n\n"
                continue
            except Exception as exc:
                errors.append(f"{rec_id}: {exc}")
                yield f"event: record-error\ndata: {json.dumps({'index': index, 'total': total, 'id': rec_id, 'message': str(exc)})}\n\n"
                continue

            yield (
                f"event: record-start\ndata: "
                f"{json.dumps({'index': index, 'total': total, 'id': rec_id, 'ip_address': record.ip_address})}"
                f"\n\n"
            )
            result_holder: dict = {}
            async for event in _combined_check_events(record, rec_id, current_user, request, auto_update, result_holder):
                yield event

            if result_holder:
                scanned += 1
                if result_holder.get("found"):
                    found_count += 1
                if result_holder.get("status_updated") or result_holder.get("hostname") or result_holder.get("os_type"):
                    updated_count += 1
            else:
                errors.append(f"{rec_id}: check failed (see error event)")

        summary = {
            "total": total, "scanned": scanned, "found": found_count,
            "updated": updated_count, "errors": errors,
        }
        yield f"event: summary\ndata: {json.dumps(summary)}\n\n"
        yield "event: complete\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/{id}/check-availability-stream")
async def check_availability_stream(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    auto_update: bool = Body(default=True, embed=True),
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> StreamingResponse:
    """Merged Check Availability — scans Device42, then Zabbix, then
    PaloAlto, then vSphere in sequence for an existing IP record
    (Server-Sent Events), emitting a progress event before and after each
    source so the UI can show 'scanning Device42… found/not found', then
    Zabbix, then PaloAlto, then vSphere. Once all four finish, the record's
    status (and, if PaloAlto found it, hostname) are updated immediately —
    see _apply_combined_check for the exact rule."""
    service = _build_service()
    record = await service.get_by_id(id)

    async def event_stream():
        async for event in _combined_check_events(record, id, current_user, request, auto_update):
            yield event
        yield "event: complete\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/check-availability-stream")
async def check_availability_stream_by_ip(
    request: Request,
    ip_address: str = Body(..., embed=True),
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> StreamingResponse:
    """Same merged Device42 → Zabbix → PaloAlto → vSphere scan as
    /{id}/check-availability-stream, for an address that has no IP record
    yet (Unused IPs page) — informational only, nothing to update."""
    try:
        ipaddress.ip_address(ip_address)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid IP address '{ip_address}'",
        ) from exc

    async def event_stream():
        device42_found = zabbix_found = paloalto_found = vsphere_found = False
        device42_name = zabbix_name = paloalto_name = vsphere_name = None

        yield f"event: progress\ndata: {json.dumps({'source': 'device42', 'status': 'checking'})}\n\n"
        try:
            device42_found, device42_name, _ = await _device42_lookup(ip_address)
            yield f"event: progress\ndata: {json.dumps({'source': 'device42', 'status': 'done', 'found': device42_found, 'name': device42_name})}\n\n"
        except Exception as exc:
            yield f"event: progress\ndata: {json.dumps({'source': 'device42', 'status': 'error', 'message': str(exc)})}\n\n"

        yield f"event: progress\ndata: {json.dumps({'source': 'zabbix', 'status': 'checking'})}\n\n"
        try:
            zabbix_found, zabbix_name, _ = await _zabbix_lookup(ip_address)
            yield f"event: progress\ndata: {json.dumps({'source': 'zabbix', 'status': 'done', 'found': zabbix_found, 'name': zabbix_name})}\n\n"
        except Exception as exc:
            yield f"event: progress\ndata: {json.dumps({'source': 'zabbix', 'status': 'error', 'message': str(exc)})}\n\n"

        yield f"event: progress\ndata: {json.dumps({'source': 'paloalto', 'status': 'checking'})}\n\n"
        try:
            paloalto_found, paloalto_name = await _paloalto_lookup(ip_address, current_user, "check-availability")
            yield f"event: progress\ndata: {json.dumps({'source': 'paloalto', 'status': 'done', 'found': paloalto_found, 'name': paloalto_name})}\n\n"
        except Exception as exc:
            yield f"event: progress\ndata: {json.dumps({'source': 'paloalto', 'status': 'error', 'message': str(exc)})}\n\n"

        yield f"event: progress\ndata: {json.dumps({'source': 'vsphere', 'status': 'checking'})}\n\n"
        vsphere_power_state = None
        try:
            vsphere_found, vsphere_name, _, vsphere_power_state = await _vsphere_lookup(ip_address)
            yield (
                f"event: progress\ndata: "
                f"{json.dumps({'source': 'vsphere', 'status': 'done', 'found': vsphere_found, 'name': _vsphere_display_name(vsphere_name, vsphere_power_state)})}"
                f"\n\n"
            )
        except Exception as exc:
            yield f"event: progress\ndata: {json.dumps({'source': 'vsphere', 'status': 'error', 'message': str(exc)})}\n\n"

        vsphere_powered_on = vsphere_found and vsphere_power_state != "off"
        found = device42_found or zabbix_found or paloalto_found or vsphere_powered_on
        yield (
            f"event: result\ndata: "
            f"{json.dumps({'ip_address': ip_address, 'found': found, 'device42_found': device42_found, 'zabbix_found': zabbix_found, 'paloalto_found': paloalto_found, 'vsphere_found': vsphere_found, 'vsphere_power_state': vsphere_power_state})}"
            f"\n\n"
        )
        yield "event: complete\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/{id}/ping", response_model=PingResult)
async def ping_ip_record(
    id: Annotated[str, Path(pattern=_OBJECTID_PATTERN)],
    request: Request,
    auto_update: bool = Body(default=True, embed=True),
    scan_source: Optional[str] = Body(default=None, embed=True),
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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
    - "paloalto": real-time lookup across every configured firewall — a
      named address object or live ARP entry counts as positive evidence.
    """
    if scan_source is not None and scan_source not in _VALID_SCAN_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown scan_source '{scan_source}'",
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
            in_use, device_name, _ = await _device42_lookup(ip)
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
            reachable, device_name, _ = await _zabbix_lookup(ip)
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

    if scan_source == "paloalto":
        try:
            palo_result = await _paloalto_full_check(ip, current_user, "check-availability")
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"PaloAlto lookup failed: {exc}",
            ) from exc
        # Full refresh, not just a status flip: hostname/description are
        # enriched from the check result too. Same asymmetric rule as
        # Device42/Zabbix — a match is strong positive evidence, but no
        # match is never treated as proof the address is unused, and
        # Reserved is never auto-downgraded.
        status_updated, new_status = await _apply_paloalto_enrichment(
            record, palo_result, id, current_user, request, auto_update,
        )
        return PingResult(
            ip_address=ip,
            reachable=palo_result.found,
            method="paloalto",
            latency_ms=None,
            status_updated=status_updated,
            new_status=new_status,
            scan_source=scan_source,
            device_name=_paloalto_device_label(palo_result),
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
    current_user: UserInToken = Depends(_ADMIN_ONLY),
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
            in_use, device_name, _ = await _device42_lookup(ip_address)
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
            reachable, device_name, _ = await _zabbix_lookup(ip_address)
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

    if scan_source == "paloalto":
        try:
            in_use, device_name = await _paloalto_lookup(ip_address, current_user, "check-availability")
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"PaloAlto lookup failed: {exc}",
            ) from exc
        return PingResult(
            ip_address=ip_address,
            reachable=in_use,
            method="paloalto",
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

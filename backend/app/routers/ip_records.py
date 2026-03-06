import csv
import io
import logging
import re
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Path, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse

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
from app.schemas.ip_record import IPRecordCreate, IPRecordResponse, IPRecordUpdate
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


_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator")
_OPERATOR_PLUS = require_role("Operator", "Administrator")
_ADMIN_ONLY = require_role("Administrator")


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
        filter_["$text"] = {"$search": search}

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
        filter_["$text"] = {"$search": search}

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

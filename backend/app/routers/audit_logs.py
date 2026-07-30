import logging
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.dependencies.pagination import PaginationParams
from app.models.audit_log import AuditAction, ResourceType
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.schemas.audit_log import AuditLogResponse, PaginatedResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])

_ADMIN_ONLY = require_role("Administrator", "SuperAdmin")


@router.get("", response_model=PaginatedResponse[AuditLogResponse])
async def list_audit_logs(
    request: Request,
    pagination: PaginationParams = Depends(),
    username: Optional[str] = Query(None, description="Filter by username"),
    action: Optional[AuditAction] = Query(None, description="Filter by action"),
    resource_type: Optional[ResourceType] = Query(None, description="Filter by resource type"),
    resource_id: Optional[str] = Query(None, description="Filter by resource ID"),
    date_from: Optional[datetime] = Query(None, description="Filter from this timestamp (ISO 8601)"),
    date_to: Optional[datetime] = Query(None, description="Filter up to this timestamp (ISO 8601)"),
    current_user: UserInToken = Depends(_ADMIN_ONLY),
) -> PaginatedResponse[AuditLogResponse]:
    filter_: dict = {}

    if username:
        filter_["username"] = {"$regex": re.escape(username), "$options": "i"}
    if action:
        filter_["action"] = action.value
    if resource_type:
        filter_["resource_type"] = resource_type.value
    if resource_id:
        filter_["resource_id"] = resource_id

    if date_from or date_to:
        ts_filter: dict = {}
        if date_from:
            ts_filter["$gte"] = date_from
        if date_to:
            ts_filter["$lte"] = date_to
        filter_["timestamp"] = ts_filter

    db = get_database()
    repo = AuditLogRepository(db["audit_logs"])

    logs, total = await repo.find_all(
        filter_=filter_,
        skip=pagination.skip,
        limit=pagination.page_size,
        sort=[("timestamp", -1)],
    )

    items = [
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

    return PaginatedResponse.create(
        items=items,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )

import logging
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.models.user import UserInToken
from app.repositories.ip_record_repository import IPRecordRepository
from app.repositories.subnet_repository import SubnetRepository
from app.schemas.conflicts import ConflictReport
from app.services.conflict_service import ConflictService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/subnets", tags=["conflicts"])

_OPERATOR = require_role("Operator", "Administrator")


@router.post("/{id}/scan-conflicts", response_model=ConflictReport)
async def scan_conflicts(
    id: str,
    current_user: UserInToken = Depends(_OPERATOR),
) -> ConflictReport:
    """
    Scans all IP records within the given subnet for DNS conflicts.
    Checks: forward mismatch, PTR mismatch, missing forward record, duplicate hostnames.
    """
    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    subnet = await subnet_repo.find_by_id(id)
    if subnet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subnet not found")

    records, _ = await ip_repo.find_all({"subnet_id": id}, skip=0, limit=10_000)

    return ConflictService.scan_subnet(subnet_id=id, ip_records=records)

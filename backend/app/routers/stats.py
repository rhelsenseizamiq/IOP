import ipaddress
import logging

from fastapi import APIRouter, Depends, Request

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.models.ip_record import Environment, IPStatus, OSType
from app.models.user import UserInToken
from app.repositories.aggregate_repository import AggregateRepository
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.ip_record_repository import IPRecordRepository
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.vrf_repository import VRFRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stats", tags=["stats"])

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator")


@router.get("")
async def get_dashboard_stats(
    request: Request,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> dict:
    db = get_database()
    ip_repo = IPRecordRepository(db["ip_records"])
    subnet_repo = SubnetRepository(db["subnets"])
    vrf_repo = VRFRepository(db["vrfs"])
    agg_repo = AggregateRepository(db["aggregates"])
    audit_repo = AuditLogRepository(db["audit_logs"])

    # Status / OS / environment breakdowns via aggregation
    status_breakdown = await ip_repo.aggregate_by_field("status")
    for s in IPStatus:
        status_breakdown.setdefault(s.value, 0)

    os_breakdown = await ip_repo.aggregate_by_field("os_type")
    for os in OSType:
        os_breakdown.setdefault(os.value, 0)

    env_breakdown = await ip_repo.aggregate_by_field("environment")
    for env in Environment:
        env_breakdown.setdefault(env.value, 0)

    total_ips = sum(status_breakdown.values())

    # Collection counts
    total_subnets = await subnet_repo.count({})
    total_vrfs = await vrf_repo.count({})
    total_aggregates = await agg_repo.count({})

    # Build subnet utilization list
    all_subnets, _ = await subnet_repo.find_all({}, skip=0, limit=10_000)
    subnet_ids = [s.id for s in all_subnets if s.id]
    ip_counts = await ip_repo.count_by_status_for_subnets(subnet_ids)

    subnet_utils = []
    for subnet in all_subnets:
        counts = ip_counts.get(subnet.id, {})
        try:
            network = ipaddress.ip_network(subnet.cidr, strict=False)
            total_ips_subnet = network.num_addresses
        except ValueError:
            total_ips_subnet = 0
        used = counts.get(IPStatus.IN_USE.value, 0)
        utilization_pct = round((used / total_ips_subnet * 100), 1) if total_ips_subnet > 0 else 0.0
        alert_threshold = getattr(subnet, "alert_threshold", None)
        subnet_utils.append({
            "id": subnet.id,
            "cidr": subnet.cidr,
            "name": subnet.name,
            "utilization_pct": utilization_pct,
            "alert_threshold": alert_threshold,
        })

    # Critical subnets: those exceeding their alert_threshold
    critical_subnets = [
        s for s in subnet_utils
        if s["alert_threshold"] is not None and s["utilization_pct"] >= s["alert_threshold"]
    ]

    # If no alert-triggered subnets, fall back to top 5 by utilization
    if not critical_subnets:
        critical_subnets = sorted(subnet_utils, key=lambda x: x["utilization_pct"], reverse=True)[:5]

    # Recent activity — last 5 audit log entries
    logs, _ = await audit_repo.find_all(
        filter_={},
        skip=0,
        limit=5,
        sort=[("timestamp", -1)],
    )
    recent_activity = [
        {
            "timestamp": log.timestamp.isoformat(),
            "username": log.username,
            "action": log.action.value,
            "resource_type": log.resource_type.value,
            "summary": log.detail or f"{log.action.value} {log.resource_type.value}",
        }
        for log in logs
    ]

    return {
        "total_ips": total_ips,
        "status_breakdown": status_breakdown,
        "os_breakdown": os_breakdown,
        "environment_breakdown": env_breakdown,
        "total_subnets": total_subnets,
        "total_vrfs": total_vrfs,
        "total_aggregates": total_aggregates,
        "critical_subnets": critical_subnets,
        "recent_activity": recent_activity,
    }

import ipaddress
import logging
from datetime import datetime, timedelta, timezone

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

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator", "SuperAdmin")

# Must match SubnetService._UNUSED_SCAN_CAP — keeps this dashboard total
# consistent with what the Unused IPs page would actually show per subnet.
_UNUSED_SCAN_CAP = 65536


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

    # vSphere-tracked power state — only ever set from vCenter (nightly sync
    # or a live Check Availability run), so this naturally excludes every
    # record vCenter has never matched rather than showing a dominant
    # "unknown" bucket for the ~94% of IPs with no vSphere data at all.
    power_state_breakdown = await ip_repo.aggregate_by_field("power_state")
    for state in ("on", "off"):
        power_state_breakdown.setdefault(state, 0)

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
    unused_ips_total = 0
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

        # Unused = addresses in range with no IP record at all (any status),
        # same definition as the Unused IPs page, capped the same way.
        recorded = sum(counts.values())
        capacity = min(total_ips_subnet, _UNUSED_SCAN_CAP)
        unused_ips_total += max(capacity - recorded, 0)

    # IPv4 / IPv6 subnet + IP record counts
    subnet_v4_count = sum(1 for s in all_subnets if getattr(s, "ip_version", 4) == 4)
    subnet_v6_count = sum(1 for s in all_subnets if getattr(s, "ip_version", 4) == 6)

    ip_v4_count = 0
    ip_v6_count = 0
    for subnet in all_subnets:
        counts = ip_counts.get(subnet.id, {})
        total_in_subnet = sum(counts.values())
        if getattr(subnet, "ip_version", 4) == 6:
            ip_v6_count += total_in_subnet
        else:
            ip_v4_count += total_in_subnet

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

    # Nightly sync health — written by scripts/device42_sync.py,
    # scripts/zabbix_sync.py, scripts/paloalto_sync.py, and
    # scripts/vcenter_sync.py at the end of each cron run (see
    # scripts/README.md)
    sync_status: dict = {}
    sync_docs = await db["sync_status"].find({}).to_list(length=10)
    for doc in sync_docs:
        source = doc.get("_id")
        if not source:
            continue
        last_run_at = doc.get("last_run_at")
        sync_status[source] = {
            "last_run_at": last_run_at.isoformat() if last_run_at else None,
            "status": doc.get("status"),
            "duration_seconds": doc.get("duration_seconds"),
            "counters": doc.get("counters", {}),
            "error": doc.get("error"),
        }

    # PaloAlto Check Availability activity — separate from the nightly sync
    # above: this reflects real-time on-demand lookups (paloalto_check_logs,
    # 30-day TTL), not the once-a-night full inventory pull.
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(days=7)
    paloalto_logs = db["paloalto_check_logs"]

    checks_24h = await paloalto_logs.count_documents({"checked_at": {"$gte": day_ago}})
    checks_7d = await paloalto_logs.count_documents({"checked_at": {"$gte": week_ago}})
    checks_7d_found = await paloalto_logs.count_documents({
        "checked_at": {"$gte": week_ago}, "found": True,
    })
    found_pct_7d = round(checks_7d_found / checks_7d * 100, 1) if checks_7d else None

    recent_checks = []
    cursor = paloalto_logs.find(
        {},
        {"_id": 0, "ip_address": 1, "found": 1, "hostname": 1, "checked_by": 1, "checked_at": 1},
    ).sort("checked_at", -1).limit(5)
    async for doc in cursor:
        checked_at = doc.get("checked_at")
        recent_checks.append({
            "ip_address": doc.get("ip_address"),
            "found": doc.get("found", False),
            "hostname": doc.get("hostname"),
            "checked_by": doc.get("checked_by"),
            "checked_at": checked_at.isoformat() if checked_at else None,
        })

    paloalto_activity = {
        "checks_24h": checks_24h,
        "checks_7d": checks_7d,
        "found_pct_7d": found_pct_7d,
        "recent_checks": recent_checks,
    }

    # Stale "In Use" records — every write path that confirms a record is
    # still in use (nightly Device42/Zabbix/PaloAlto sync, or a manual Check
    # Availability) bumps updated_at via IPRecordRepository.update(), even
    # when no field value actually changes. So an old updated_at on an
    # "In Use" record genuinely means none of the three sources — nor a
    # person — has re-confirmed it in that long; purely informational, no
    # status is touched here.
    _STALE_DAYS = 90
    # Motor/PyMongo returns naive datetimes (already UTC) for values stored
    # by the rest of the app (e.g. IPRecordRepository.update() uses
    # datetime.now(timezone.utc) but Mongo strips tzinfo on round-trip) — mixing
    # that with an aware `now` raises TypeError on subtraction, so compare
    # in the naive domain here specifically.
    now_naive = now.replace(tzinfo=None)
    stale_cutoff = now_naive - timedelta(days=_STALE_DAYS)
    stale_filter = {"status": IPStatus.IN_USE.value, "updated_at": {"$lt": stale_cutoff}}
    ip_records_col = db["ip_records"]

    _STALE_SAMPLE_CAP = 500
    stale_count = await ip_records_col.count_documents(stale_filter)
    stale_samples = []
    stale_cursor = ip_records_col.find(
        stale_filter,
        {"ip_address": 1, "hostname": 1, "updated_at": 1, "updated_by": 1},
    ).sort("updated_at", 1).limit(_STALE_SAMPLE_CAP)
    async for doc in stale_cursor:
        updated_at = doc.get("updated_at")
        stale_samples.append({
            "id": str(doc["_id"]),
            "ip_address": doc.get("ip_address"),
            "hostname": doc.get("hostname"),
            "updated_by": doc.get("updated_by"),
            "updated_at": updated_at.isoformat() if updated_at else None,
            "days_since_update": (now_naive - updated_at).days if updated_at else None,
        })

    stale_in_use = {
        "threshold_days": _STALE_DAYS,
        "count": stale_count,
        "samples": stale_samples,
    }

    # Duplicate hostnames summary — lightweight counts only (no record
    # lists), so this stays cheap enough for the dashboard's hot path.
    # IP-address duplicates are omitted here: a unique compound index
    # (vrf_id + ip_address) should make them structurally impossible, so
    # they're not worth a dashboard tile — full detail for both is still
    # available via GET /ip-records/duplicates.
    dup_cursor = ip_records_col.aggregate([
        {"$match": {"hostname": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$hostname", "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
        {"$group": {"_id": None, "groups": {"$sum": 1}, "records": {"$sum": "$count"}}},
    ])
    dup_result = await dup_cursor.to_list(length=1)
    dup_totals = dup_result[0] if dup_result else {"groups": 0, "records": 0}
    duplicates_summary = {
        "hostname_groups": dup_totals["groups"],
        "hostname_records": dup_totals["records"],
    }

    return {
        "total_ips": total_ips,
        "status_breakdown": status_breakdown,
        "os_breakdown": os_breakdown,
        "subnet_v4_count": subnet_v4_count,
        "subnet_v6_count": subnet_v6_count,
        "ip_v4_count": ip_v4_count,
        "ip_v6_count": ip_v6_count,
        "environment_breakdown": env_breakdown,
        "power_state_breakdown": power_state_breakdown,
        "total_subnets": total_subnets,
        "total_vrfs": total_vrfs,
        "total_aggregates": total_aggregates,
        "critical_subnets": critical_subnets,
        "recent_activity": recent_activity,
        "unused_ips_total": unused_ips_total,
        "sync_status": sync_status,
        "paloalto_activity": paloalto_activity,
        "stale_in_use": stale_in_use,
        "duplicates_summary": duplicates_summary,
    }

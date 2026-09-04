"""
One-time / recurring full Zabbix -> IPAM sync.

Unlike Device42, Zabbix has no subnet concept of its own — each host just
has an IP. So for every host IP we find the most specific (longest-prefix)
existing IPAM subnet that contains it, and skip if none matches (never
auto-create speculative subnets from monitoring data).

Every ENABLED host returned by Zabbix is a real, actively-managed/monitored
asset, so it's recorded as "In Use" regardless of momentary availability —
a temporarily-down monitored server is still in use by inventory, just not
currently reachable (see Check Availability's separate, live-status Zabbix
lookup for that distinction).

DISABLED hosts are treated more carefully: if a disabled host still has
recent data (within STALE_MONTHS), it's likely just paused and still
counted as in use. If its latest data is older than that (or it has none
at all), it's probably decommissioned — skipped entirely, never
create/update an IP record's status from it. This intentionally relies on
crontab ordering: Device42 syncs first (2:00 AM), Zabbix second (2:35 AM),
so skipping here never overwrites a correct Device42-derived status.

Requires ZABBIX_HOST / ZABBIX_TOKEN in the environment.

Run inside the iop-api container:
    docker exec -e ZABBIX_HOST -e ZABBIX_TOKEN iop-api python /app/zabbix_sync.py
"""
import asyncio
import ipaddress
import logging
import os
import sys
import time
from datetime import datetime, timezone

import httpx

from app.core.database import connect_to_mongo, close_mongo_connection, get_database
from app.core.environment_heuristics import looks_like_test
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.ip_record_repository import IPRecordRepository

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("zabbix_sync")

ZABBIX_HOST = os.environ["ZABBIX_HOST"]
ZABBIX_TOKEN = os.environ["ZABBIX_TOKEN"]
PAGE_LIMIT = int(os.environ.get("ZBX_LIMIT", "10000"))
STALE_MONTHS = 6
STALE_THRESHOLD_SECONDS = STALE_MONTHS * 30 * 24 * 3600


async def zbx_rpc(client: httpx.AsyncClient, method: str, params: dict) -> dict:
    resp = await client.post(
        f"{ZABBIX_HOST}/api_jsonrpc.php",
        json={"jsonrpc": "2.0", "method": method, "params": params, "id": 1},
        headers={"Content-Type": "application/json-rpc"},
    )
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"Zabbix API error: {data['error']}")
    return data["result"]


async def is_stale_disabled(client: httpx.AsyncClient, hostid: str, status: str) -> bool:
    """True if this host is disabled AND has no data (or only data older
    than STALE_MONTHS) — the signal that it's likely decommissioned, not
    just temporarily paused."""
    if status != "1":
        return False
    items = await zbx_rpc(client, "item.get", {"hostids": [hostid], "output": ["lastclock"]})
    max_clock = 0
    for item in items:
        try:
            clock = int(item.get("lastclock") or 0)
        except (TypeError, ValueError):
            clock = 0
        max_clock = max(max_clock, clock)
    if max_clock == 0:
        return True
    return (time.time() - max_clock) > STALE_THRESHOLD_SECONDS


def environment_for(hostname: str | None) -> str:
    if looks_like_test(hostname):
        return "Test"
    return "Production"


def build_subnet_index(subnets) -> list[tuple]:
    """Returns [(network, prefixlen, subnet_id)], for longest-prefix matching."""
    index = []
    for s in subnets:
        try:
            network = ipaddress.ip_network(s.cidr, strict=False)
        except ValueError:
            continue
        index.append((network, network.prefixlen, s.id))
    return index


def find_subnet(ip_str: str, index: list[tuple]) -> str | None:
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return None
    best_id = None
    best_prefix = -1
    for network, prefixlen, subnet_id in index:
        if addr.version == network.version and addr in network and prefixlen > best_prefix:
            best_id = subnet_id
            best_prefix = prefixlen
    return best_id


async def main() -> None:
    start = time.time()
    await connect_to_mongo()
    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    log.info("=== loading existing subnets for CIDR matching ===")
    all_subnets = await subnet_repo.find_all_in_vrf(vrf_id=None)
    subnet_index = build_subnet_index(all_subnets)
    log.info("loaded %d subnets", len(subnet_index))

    counters = {
        "hosts_seen": 0,
        "hosts_skipped_stale_disabled": 0,
        "ips_created": 0,
        "ips_updated": 0,
        "ips_skipped_no_subnet": 0,
        "ips_skipped_invalid": 0,
        "errors": 0,
    }
    error_samples: list[str] = []
    run_error: str | None = None

    try:
        await _run_sync(subnet_index, counters, error_samples, ip_repo)
    except Exception as exc:
        run_error = str(exc)
        log.exception("zabbix sync failed")

    duration = time.time() - start
    log.info("=== DONE in %.0fs ===", duration)
    log.info("FINAL COUNTERS: %s", counters)
    if error_samples:
        log.info("SAMPLE ERRORS: %s", error_samples)

    try:
        await db["sync_status"].update_one(
            {"_id": "zabbix"},
            {"$set": {
                "last_run_at": datetime.now(timezone.utc),
                "status": "error" if run_error else "ok",
                "duration_seconds": round(duration, 1),
                "counters": counters,
                "error": run_error,
            }},
            upsert=True,
        )
    except Exception:
        log.exception("failed to write sync_status")

    await close_mongo_connection()

    if run_error:
        raise RuntimeError(run_error)


async def _run_sync(subnet_index, counters, error_samples, ip_repo) -> None:
    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {ZABBIX_TOKEN}"},
        verify=False,
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        log.info("=== fetching hosts from Zabbix ===")
        hosts = await zbx_rpc(client, "host.get", {
            "output": ["hostid", "host", "name", "status"],
            "selectInterfaces": ["ip", "available"],
            "limit": PAGE_LIMIT,
        })
        log.info("fetched %d hosts", len(hosts))

        for h in hosts:
            counters["hosts_seen"] += 1
            hostname = h.get("name") or h.get("host")

            if await is_stale_disabled(client, h["hostid"], h.get("status", "0")):
                counters["hosts_skipped_stale_disabled"] += 1
                continue

            for iface in h.get("interfaces", []):
                ip_addr = (iface.get("ip") or "").strip()
                if not ip_addr:
                    continue
                try:
                    ipaddress.ip_address(ip_addr)
                except ValueError:
                    counters["ips_skipped_invalid"] += 1
                    continue

                subnet_id = find_subnet(ip_addr, subnet_index)
                if subnet_id is None:
                    counters["ips_skipped_no_subnet"] += 1
                    continue

                environment = environment_for(hostname)
                description = f"Imported from Zabbix: {hostname or ip_addr}"

                try:
                    existing = await ip_repo.find_by_ip(ip_addr)
                    if existing is not None:
                        update_fields = {
                            "hostname": hostname,
                            "subnet_id": subnet_id,
                            "vrf_id": None,
                            "description": description,
                            "updated_by": "zabbix-sync",
                        }
                        # Reserved is a manual, intentional hold that Zabbix
                        # has no concept of — never let a sync clobber it.
                        if existing.status.value != "Reserved":
                            update_fields["status"] = "In Use"
                        await ip_repo.update(existing.id, update_fields)
                        counters["ips_updated"] += 1
                    else:
                        now = datetime.now(timezone.utc)
                        await ip_repo.create({
                            "ip_address": ip_addr,
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
                            "created_by": "zabbix-sync",
                            "updated_by": "zabbix-sync",
                            "reserved_at": None,
                            "reserved_by": None,
                        })
                        counters["ips_created"] += 1
                except Exception as exc:
                    counters["errors"] += 1
                    if len(error_samples) < 30:
                        error_samples.append(f"{ip_addr}: {exc}")


if __name__ == "__main__":
    asyncio.run(main())

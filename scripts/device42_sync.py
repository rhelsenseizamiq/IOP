"""
Recurring full Device42 -> IPAM sync.

Pulls ALL subnets, devices, and IPs from Device42 (not the UI's 2000-row
default) and creates/updates matching Subnet + IPRecord documents directly
via this app's own repositories, so all validation/model rules still apply.
Idempotent: safe to run nightly via cron (see run_device42_sync.sh).

Requires D42_HOST / D42_USER / D42_PASS in the environment.

Run inside the iop-api container (has motor/httpx/pydantic + app modules):
    docker exec -e D42_HOST -e D42_USER -e D42_PASS iop-api python /app/device42_sync.py
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
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.ip_record_repository import IPRecordRepository

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("device42_sync")

D42_HOST = os.environ["D42_HOST"]
D42_USER = os.environ["D42_USER"]
D42_PASS = os.environ["D42_PASS"]
PAGE_SIZE = 500
MAX_IPS = int(os.environ.get("D42_MAX_IPS", "0")) or None  # 0/unset = no cap (full run)

_OS_HINT_MAP = {
    "linux": "Linux",
    "windows": "Windows",
    "darwin": "macOS",
    "mac": "macOS",
    "aix": "AIX",
    "rhel": "Linux",
    "centos": "Linux",
    "ubuntu": "Linux",
    "debian": "Linux",
    "redhat": "Linux",
    "suse": "Linux",
    "openshift": "OpenShift",
}


def map_os(os_name):
    if not os_name:
        return "Unknown"
    lc = os_name.lower()
    for fragment, os_type in _OS_HINT_MAP.items():
        if fragment in lc:
            return os_type
    return "Unknown"


def subnet_environment(service_level):
    if service_level and str(service_level).strip().upper() == "TEST":
        return "Test"
    return "Production"


def ip_environment(hostname, subnet_default_env):
    if hostname and "test" in hostname.lower():
        return "Test"
    return subnet_default_env


async def fetch_all_devices(client: httpx.AsyncClient) -> dict:
    device_os = {}
    offset = 0
    while True:
        resp = await client.get(
            f"{D42_HOST}/api/1.0/devices/",
            params={"limit": PAGE_SIZE, "offset": offset, "include_cols": "name,os"},
        )
        resp.raise_for_status()
        data = resp.json()
        devices = data.get("Devices", [])
        if not devices:
            break
        for d in devices:
            name = d.get("name")
            if name:
                device_os[name] = map_os(d.get("os"))
        total = data.get("total_count", 0)
        offset += len(devices)
        log.info("devices: fetched %d/%d", offset, total)
        if offset >= total:
            break
    return device_os


async def fetch_all_subnets(client: httpx.AsyncClient) -> dict:
    """Returns {d42_subnet_id: {cidr, name, gateway, environment}}"""
    subnets = {}
    offset = 0
    while True:
        resp = await client.get(
            f"{D42_HOST}/api/1.0/subnets/", params={"limit": PAGE_SIZE, "offset": offset}
        )
        resp.raise_for_status()
        data = resp.json()
        rows = data.get("subnets", [])
        if not rows:
            break
        for s in rows:
            sid = s.get("subnet_id")
            network = s.get("network")
            mask_bits = s.get("mask_bits")
            if sid is None or network is None or mask_bits is None:
                continue
            cidr = f"{network}/{mask_bits}"
            subnets[sid] = {
                "cidr": cidr,
                "name": (s.get("name") or cidr)[:100],
                "gateway": s.get("gateway") or None,
                "environment": subnet_environment(s.get("service_level")),
            }
        total = data.get("total_count", 0)
        offset += len(rows)
        log.info("subnets: fetched %d/%d", offset, total)
        if offset >= total:
            break
    return subnets


async def get_or_create_subnet(subnet_repo, cache, d42_meta_map, d42_subnet_id, counters):
    if d42_subnet_id in cache:
        return cache[d42_subnet_id]

    meta = d42_meta_map.get(d42_subnet_id)
    if meta is None:
        cache[d42_subnet_id] = None
        return None

    cidr = meta["cidr"]
    if cidr in ("0.0.0.0/0", "::/0"):
        cache[d42_subnet_id] = None
        return None

    try:
        network = ipaddress.ip_network(cidr, strict=False)
        if network.prefixlen == 0:
            # Any other catch-all/default-route-shaped entry Device42 might
            # use as its "unassigned" bucket, IPv4 or IPv6.
            cache[d42_subnet_id] = None
            return None
    except ValueError:
        cache[d42_subnet_id] = None
        return None

    existing = await subnet_repo.find_by_cidr(cidr, None)
    if existing is not None:
        cache[d42_subnet_id] = existing.id
        counters["subnets_matched"] += 1
        return existing.id

    gw = meta["gateway"]
    if gw:
        try:
            if ipaddress.ip_address(gw) not in network:
                gw = None
        except ValueError:
            gw = None

    now = datetime.now(timezone.utc)
    doc = {
        "cidr": cidr,
        "name": meta["name"],
        "description": "Imported from Device42",
        "gateway": gw,
        "vlan_id": None,
        "environment": meta["environment"],
        "parent_id": None,
        "vrf_id": None,
        "prefix_len": network.prefixlen,
        "alert_threshold": None,
        "ip_version": 4,
        "created_at": now,
        "updated_at": now,
        "created_by": "device42-sync",
        "updated_by": "device42-sync",
    }
    try:
        created = await subnet_repo.create(doc)
        cache[d42_subnet_id] = created.id
        counters["subnets_created"] += 1
        return created.id
    except Exception as exc:
        log.warning("subnet create failed for %s: %s", cidr, exc)
        cache[d42_subnet_id] = None
        return None


async def main():
    start = time.time()
    await connect_to_mongo()
    db = get_database()
    subnet_repo = SubnetRepository(db["subnets"])
    ip_repo = IPRecordRepository(db["ip_records"])

    counters = {
        "subnets_created": 0,
        "subnets_matched": 0,
        "ips_created": 0,
        "ips_updated": 0,
        "ips_skipped_no_subnet": 0,
        "ips_skipped_invalid": 0,
        "errors": 0,
    }
    error_samples = []
    run_error: str | None = None

    try:
        await _run_sync(subnet_repo, ip_repo, counters, error_samples, start)
    except Exception as exc:
        run_error = str(exc)
        log.exception("device42 sync failed")

    duration = time.time() - start
    log.info("=== DONE in %.0fs ===", duration)
    log.info("FINAL COUNTERS: %s", counters)
    if error_samples:
        log.info("SAMPLE ERRORS: %s", error_samples)

    try:
        await db["sync_status"].update_one(
            {"_id": "device42"},
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


async def _run_sync(subnet_repo, ip_repo, counters, error_samples, start) -> None:
    async with httpx.AsyncClient(
        auth=(D42_USER, D42_PASS), verify=False, timeout=60.0, follow_redirects=True
    ) as client:
        log.info("=== fetching devices ===")
        device_os = await fetch_all_devices(client)
        log.info("devices done: %d", len(device_os))

        log.info("=== fetching subnets ===")
        d42_subnets = await fetch_all_subnets(client)
        log.info("subnets done: %d", len(d42_subnets))

        subnet_cache: dict = {}

        log.info("=== fetching + importing IPs ===")
        offset = 0
        page_num = 0
        while True:
            resp = await client.get(
                f"{D42_HOST}/api/1.0/ips/", params={"limit": PAGE_SIZE, "offset": offset}
            )
            resp.raise_for_status()
            data = resp.json()
            rows = data.get("ips", [])
            if not rows:
                break

            for entry in rows:
                ip_addr = (entry.get("ip") or "").strip()
                if not ip_addr:
                    continue
                try:
                    ipaddress.ip_address(ip_addr)
                except ValueError:
                    counters["ips_skipped_invalid"] += 1
                    continue

                d42_subnet_id = entry.get("subnet_id")
                mongo_subnet_id = await get_or_create_subnet(
                    subnet_repo, subnet_cache, d42_subnets, d42_subnet_id, counters
                )
                if mongo_subnet_id is None:
                    counters["ips_skipped_no_subnet"] += 1
                    continue

                subnet_meta = d42_subnets.get(d42_subnet_id, {})
                default_env = subnet_meta.get("environment", "Production")

                hostname = entry.get("device") or None
                os_type = device_os.get(hostname, "Unknown") if hostname else "Unknown"
                environment = ip_environment(hostname, default_env)
                is_available = (entry.get("available") or "no").lower() == "yes"
                ip_status = "Free" if is_available else "In Use"
                description = f"Imported from Device42: {hostname or ip_addr}"

                try:
                    existing = await ip_repo.find_by_ip(ip_addr)
                    if existing is not None:
                        await ip_repo.update(existing.id, {
                            "hostname": hostname,
                            "os_type": os_type,
                            "subnet_id": mongo_subnet_id,
                            "vrf_id": None,
                            "status": ip_status,
                            "environment": environment,
                            "description": description,
                            "updated_by": "device42-sync",
                        })
                        counters["ips_updated"] += 1
                    else:
                        now = datetime.now(timezone.utc)
                        await ip_repo.create({
                            "ip_address": ip_addr,
                            "hostname": hostname,
                            "os_type": os_type,
                            "subnet_id": mongo_subnet_id,
                            "vrf_id": None,
                            "status": ip_status,
                            "environment": environment,
                            "owner": None,
                            "description": description,
                            "created_at": now,
                            "updated_at": now,
                            "created_by": "device42-sync",
                            "updated_by": "device42-sync",
                            "reserved_at": None,
                            "reserved_by": None,
                        })
                        counters["ips_created"] += 1
                except Exception as exc:
                    counters["errors"] += 1
                    if len(error_samples) < 30:
                        error_samples.append(f"{ip_addr}: {exc}")

            total = data.get("total_count", 0)
            offset += len(rows)
            page_num += 1
            if page_num % 5 == 0 or offset >= total:
                elapsed = time.time() - start
                log.info(
                    "progress: %d/%d IPs | created=%d updated=%d skipped_no_subnet=%d "
                    "skipped_invalid=%d errors=%d | subnets created=%d matched=%d | %.0fs elapsed",
                    offset, total,
                    counters["ips_created"], counters["ips_updated"],
                    counters["ips_skipped_no_subnet"], counters["ips_skipped_invalid"],
                    counters["errors"], counters["subnets_created"], counters["subnets_matched"],
                    elapsed,
                )
            if offset >= total:
                break
            if MAX_IPS and offset >= MAX_IPS:
                log.info("MAX_IPS cap (%d) reached, stopping test run early", MAX_IPS)
                break


if __name__ == "__main__":
    asyncio.run(main())

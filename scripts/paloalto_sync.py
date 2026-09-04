"""
Recurring PaloAlto -> IPAM sync.

Pulls named /32 (or /128) address objects from every configured firewall —
single-host security objects an admin has explicitly created, the closest
PaloAlto equivalent to Device42's curated inventory — and creates/updates
matching IPRecord documents directly via this app's own repositories, so
all validation/model rules still apply. Idempotent: safe to run nightly via
cron (see run_paloalto_sync.sh).

Deliberately skips ip-range, fqdn, and wider-than-/32 address objects: those
represent NAT pools, whole networks, or remote resources rather than a
single host, and importing them as inventory would be misleading.

discover() also returns the live ARP table, but that is NOT used here on
purpose: an ARP table reflects every transient L2 neighbor a firewall has
seen (laptops, phones, anything passing through), not curated inventory —
bulk-importing it would flood IPAM with noise. That data stays available
through the manual discover/import UI flow instead, where a human picks
which rows to import.

Requires PALOALTO_HOSTS (comma-separated) / PALOALTO_USERNAME /
PALOALTO_PASSWORD in the environment.

Run inside the iop-api container (has httpx/pydantic + app modules):
    docker exec -e PALOALTO_HOSTS -e PALOALTO_USERNAME -e PALOALTO_PASSWORD \
        iop-api python /app/paloalto_sync.py
"""
import asyncio
import ipaddress
import logging
import os
import sys
import time
from datetime import datetime, timezone

from app.core.database import connect_to_mongo, close_mongo_connection, get_database
from app.core.environment_heuristics import looks_like_test
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.ip_record_repository import IPRecordRepository
from app.services.paloalto_service import PaloAltoService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("paloalto_sync")

PALOALTO_HOSTS = [h.strip() for h in os.environ["PALOALTO_HOSTS"].split(",") if h.strip()]
PALOALTO_USERNAME = os.environ["PALOALTO_USERNAME"]
PALOALTO_PASSWORD = os.environ["PALOALTO_PASSWORD"]


def environment_for(name: str | None) -> str:
    if looks_like_test(name):
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


def single_host_ip(addr) -> str | None:
    """Bare IP if this address object is a /32 (or /128) single-host entry, else None."""
    if not addr.ip_netmask:
        return None
    try:
        network = ipaddress.ip_network(addr.ip_netmask, strict=False)
    except ValueError:
        return None
    if network.num_addresses != 1:
        return None
    return str(network.network_address)


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
        "hosts_failed": 0,
        "addresses_seen": 0,
        "addresses_skipped_not_host": 0,
        "ips_created": 0,
        "ips_updated": 0,
        "ips_skipped_no_subnet": 0,
        "errors": 0,
    }
    error_samples: list[str] = []
    run_error: str | None = None

    try:
        await _run_sync(subnet_index, counters, error_samples, ip_repo)
    except Exception as exc:
        run_error = str(exc)
        log.exception("paloalto sync failed")

    duration = time.time() - start
    log.info("=== DONE in %.0fs ===", duration)
    log.info("FINAL COUNTERS: %s", counters)
    if error_samples:
        log.info("SAMPLE ERRORS: %s", error_samples)

    try:
        await db["sync_status"].update_one(
            {"_id": "paloalto"},
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
    for host in PALOALTO_HOSTS:
        counters["hosts_seen"] += 1
        log.info("=== discovering %s ===", host)
        try:
            result = await PaloAltoService.discover(
                host, PALOALTO_USERNAME, PALOALTO_PASSWORD, verify_ssl=False,
            )
        except Exception as exc:
            counters["hosts_failed"] += 1
            if len(error_samples) < 30:
                error_samples.append(f"{host}: {exc}")
            log.warning("skipping %s: %s", host, exc)
            continue

        for addr in result.addresses:
            counters["addresses_seen"] += 1
            ip_addr = single_host_ip(addr)
            if ip_addr is None:
                counters["addresses_skipped_not_host"] += 1
                continue

            subnet_id = find_subnet(ip_addr, subnet_index)
            if subnet_id is None:
                counters["ips_skipped_no_subnet"] += 1
                continue

            hostname = addr.name
            environment = environment_for(hostname)
            description = addr.description or f"Imported from PaloAlto ({host}): {hostname}"

            try:
                existing = await ip_repo.find_by_ip(ip_addr)
                if existing is not None:
                    update_fields = {
                        "hostname": hostname,
                        "subnet_id": subnet_id,
                        "vrf_id": None,
                        "description": description,
                        "updated_by": "paloalto-sync",
                    }
                    # Reserved is a manual, intentional hold that PaloAlto
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
                        "created_by": "paloalto-sync",
                        "updated_by": "paloalto-sync",
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

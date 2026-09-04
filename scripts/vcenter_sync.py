"""
Nightly vCenter -> IPAM sync.

Discovers every powered-on VM across all configured vCenters (VCENTER_HOSTS,
comma-separated — shared read-only service account) and, for each of its
guest IP addresses, finds the most specific (longest-prefix) existing IPAM
subnet that contains it — same approach as zabbix_sync.py. Never
auto-creates speculative subnets from discovery data.

What vCenter contributes: IP address, hostname (the guest's own DNS name,
as reported by VMware Tools — normally more authoritative than a
network-side guess, EXCEPT when the guest OS was never actually
customized after clone/template deploy, in which case VMware Tools just
reports the OS's unconfigured default like "localhost.localdomain"; see
_real_dns_name for the fallback to vCenter's own inventory name in that
case), OS type (best-effort guess from guestFullName), and
presence/status. Hostname is applied on both create and update — same as
Zabbix's sync. Environment is
auto-tagged DR only when a VM's own datacenter/cluster name actually says
so (see environment_for) — NOT from which vCenter it was discovered on;
an earlier version wrongly treated every VM on vcenterbaku.ibar.int as DR,
which broke on real workloads that vCenter also hosts (e.g. a shared NTP
"timeserver"). On an existing record this only ever promotes to DR, never
overwrites a weaker existing classification.

Every VM found here is powered on and has live guest IPs reported by
VMware Tools, so it's recorded as "In Use" — same rationale as Zabbix's
"every ENABLED host is a real, actively-managed asset" rule. A powered-off
VM is skipped entirely (VMware Tools normally reports no guest IPs for one
anyway, but this is an explicit, defensive check rather than relying on
that).

Requires VCENTER_HOSTS / VCENTER_USERNAME / VCENTER_PASSWORD in the
environment.

Run inside the iop-api container:
    docker exec -e VCENTER_HOSTS -e VCENTER_USERNAME -e VCENTER_PASSWORD -e VCENTER_VERIFY_SSL iop-api python /app/vcenter_sync.py
"""
import asyncio
import ipaddress
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone

from app.core.database import connect_to_mongo, close_mongo_connection, get_database
from app.core.environment_heuristics import looks_like_test
from app.repositories.subnet_repository import SubnetRepository
from app.repositories.ip_record_repository import IPRecordRepository
from app.services.vsphere_service import VsphereService, is_real_hostname

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("vcenter_sync")

VCENTER_HOSTS = [h.strip() for h in os.environ["VCENTER_HOSTS"].split(",") if h.strip()]
VCENTER_USERNAME = os.environ["VCENTER_USERNAME"]
VCENTER_PASSWORD = os.environ["VCENTER_PASSWORD"]
VCENTER_VERIFY_SSL = os.environ.get("VCENTER_VERIFY_SSL", "false").lower() == "true"


def environment_for(hostname: str | None, datacenter: str | None, cluster: str | None) -> str:
    """DR is tagged ONLY from the VM's own datacenter/cluster name actually
    saying so (whole-word "dr" or "disaster" — matched as a whole word so
    it doesn't false-positive on vSphere's own "DRS" cluster feature name).

    This intentionally does NOT infer DR from which vCenter a VM came from.
    An earlier version treated every VM on vcenterbaku.ibar.int as DR, which
    was wrong — that vCenter hosts a mix of workloads (e.g. a shared NTP
    "timeserver"), not exclusively DR ones. Per real data on both vCenters
    today, neither datacenter nor cluster names actually contain "dr" or
    "disaster" (vcenternc reports just "Datacenter", vcenterbaku reports
    "VxRail-Datacenter", cluster is empty on both) — so DR auto-tagging is
    effectively dormant until/unless a genuine DR-named cluster or
    datacenter shows up. That's the correct, honest state: no reliable
    signal currently exists, so nothing is guessed.

    Falls back to the existing hostname-based Test heuristic, then
    defaults to Production."""
    combined = f"{datacenter or ''} {cluster or ''}".lower()
    if re.search(r"\bdr\b", combined) or "disaster" in combined:
        return "DR"
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


def usable_guest_ip(addr: str) -> bool:
    """Filters out loopback/link-local noise that VMware Tools can report
    alongside a VM's real address (e.g. 127.0.0.1, docker/veth interfaces
    inside the guest, IPv6 link-local fe80::...) — none of these are
    meaningful IPAM entries."""
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return not (ip.is_loopback or ip.is_link_local or ip.is_multicast)


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
        "vcenters_seen": 0,
        "vcenters_failed": 0,
        "vms_seen": 0,
        "vms_skipped_powered_off": 0,
        "ips_created": 0,
        "ips_updated": 0,
        "ips_skipped_no_subnet": 0,
        "ips_skipped_invalid": 0,
        "errors": 0,
    }
    error_samples: list[str] = []
    run_error: str | None = None

    try:
        for host in VCENTER_HOSTS:
            counters["vcenters_seen"] += 1
            log.info("=== discovering VMs from %s ===", host)
            try:
                vms = await asyncio.to_thread(
                    VsphereService.discover,
                    host, VCENTER_USERNAME, VCENTER_PASSWORD, None, VCENTER_VERIFY_SSL,
                )
            except Exception as exc:
                counters["vcenters_failed"] += 1
                log.exception("failed to discover from %s", host)
                error_samples.append(f"{host}: {exc}")
                continue
            log.info("fetched %d VMs from %s", len(vms), host)
            await _sync_vms(host, vms, subnet_index, counters, error_samples, ip_repo)
    except Exception as exc:
        run_error = str(exc)
        log.exception("vcenter sync failed")

    duration = time.time() - start
    log.info("=== DONE in %.0fs ===", duration)
    log.info("FINAL COUNTERS: %s", counters)
    if error_samples:
        log.info("SAMPLE ERRORS: %s", error_samples[:30])

    try:
        await db["sync_status"].update_one(
            {"_id": "vcenter"},
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


def _real_dns_name(vm) -> str | None:
    """Falls back to vCenter's own inventory name (always real,
    human-assigned) whenever VMware Tools reports an unconfigured OS
    default like "localhost.localdomain" instead of a real hostname — see
    is_real_hostname in vsphere_service.py, the single shared guard used
    by both this nightly sync and the real-time Check Availability
    lookup."""
    return vm.guest_hostname if is_real_hostname(vm.guest_hostname) else vm.name


async def _sync_vms(host, vms, subnet_index, counters, error_samples, ip_repo) -> None:
    for vm in vms:
        counters["vms_seen"] += 1

        if vm.power_state != "on":
            counters["vms_skipped_powered_off"] += 1
            continue

        dns_name = _real_dns_name(vm)

        for ip_info in vm.ip_addresses:
            ip_addr = ip_info.address
            if not usable_guest_ip(ip_addr):
                counters["ips_skipped_invalid"] += 1
                continue

            subnet_id = find_subnet(ip_addr, subnet_index)
            if subnet_id is None:
                counters["ips_skipped_no_subnet"] += 1
                continue

            environment = environment_for(dns_name, vm.datacenter, vm.cluster)
            description = f"Synced from vCenter: {vm.name} ({host})"

            try:
                existing = await ip_repo.find_by_ip(ip_addr)
                if existing is not None:
                    update_fields = {
                        "subnet_id": subnet_id,
                        "vrf_id": None,
                        "description": description,
                        "updated_by": "vcenter-sync",
                    }
                    if dns_name:
                        update_fields["hostname"] = dns_name
                    if vm.os_type and vm.os_type != "Unknown":
                        update_fields["os_type"] = vm.os_type
                    # Every VM reaching this point is powered on (see the
                    # power-off skip above), so the batch only ever sets
                    # "on" here — a live Check Availability re-check is
                    # what can later flip a record to "off" once observed.
                    update_fields["power_state"] = "on"
                    # Only ever PROMOTE to DR, never overwrite an existing
                    # record's environment with a weaker guess (e.g. Test) —
                    # DR is the one classification worth correcting
                    # automatically, since a record still marked Production
                    # while actually running on the DR site is a real,
                    # actionable discrepancy.
                    if environment == "DR" and existing.environment.value != "DR":
                        update_fields["environment"] = "DR"
                    # Reserved is a manual, intentional hold — never let a
                    # sync clobber it (same rule as every other integration).
                    if existing.status.value != "Reserved":
                        update_fields["status"] = "In Use"
                    await ip_repo.update(existing.id, update_fields)
                    counters["ips_updated"] += 1
                else:
                    now = datetime.now(timezone.utc)
                    await ip_repo.create({
                        "ip_address": ip_addr,
                        "hostname": dns_name,
                        "os_type": vm.os_type or "Unknown",
                        "subnet_id": subnet_id,
                        "vrf_id": None,
                        "status": "In Use",
                        "environment": environment,
                        "power_state": "on",
                        "owner": None,
                        "description": description,
                        "created_at": now,
                        "updated_at": now,
                        "created_by": "vcenter-sync",
                        "updated_by": "vcenter-sync",
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

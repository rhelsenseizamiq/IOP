"""
One-time reconciliation: today's two zabbix_sync.py runs happened BEFORE the
disabled+stale exclusion existed, so they may have incorrectly marked some
IP records "In Use" purely because a Zabbix host entry existed — even when
that host is disabled and hasn't reported data in 6+ months (likely
decommissioned).

For every IP record touched by zabbix-sync today, re-check the Zabbix host's
current status/staleness. For any that are stale+disabled:
  - Live-check Device42 for independent confirmation.
    - Device42 confirms in-use -> keep "In Use", re-point description/
      hostname at Device42 as the now-authoritative source.
    - Device42 has nothing:
        - record was CREATED by zabbix-sync (no other source ever touched
          it) -> DELETE it, it only exists because of the bug.
        - record PRE-EXISTED (zabbix-sync only overwrote its status) -> we
          have no audit trail of its prior value, so don't guess: leave it
          untouched and flag for manual review.

Read-only until the final apply step; prints a full plan first.
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
from app.repositories.ip_record_repository import IPRecordRepository

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("zabbix_reconcile")

ZABBIX_HOST = os.environ["ZABBIX_HOST"]
ZABBIX_TOKEN = os.environ["ZABBIX_TOKEN"]
DEVICE42_HOST = os.environ["DEVICE42_HOST"]
DEVICE42_USER = os.environ["DEVICE42_USER"]
DEVICE42_PASS = os.environ["DEVICE42_PASS"]
STALE_THRESHOLD_SECONDS = 6 * 30 * 24 * 3600
APPLY = os.environ.get("APPLY") == "1"


async def zbx_rpc(client, method, params):
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


async def zabbix_host_state(client, ip_addr):
    """Returns (found, status, stale) for the Zabbix host owning this IP."""
    interfaces = await zbx_rpc(client, "hostinterface.get", {
        "output": ["hostid"], "filter": {"ip": ip_addr},
    })
    if not interfaces:
        return False, None, None
    hostid = interfaces[0]["hostid"]
    hosts = await zbx_rpc(client, "host.get", {"output": ["status"], "hostids": [hostid]})
    if not hosts:
        return False, None, None
    status = hosts[0]["status"]
    if status != "1":
        return True, status, False
    items = await zbx_rpc(client, "item.get", {"hostids": [hostid], "output": ["lastclock"]})
    max_clock = 0
    for item in items:
        try:
            clock = int(item.get("lastclock") or 0)
        except (TypeError, ValueError):
            clock = 0
        max_clock = max(max_clock, clock)
    stale = max_clock == 0 or (time.time() - max_clock) > STALE_THRESHOLD_SECONDS
    return True, status, stale


async def device42_confirms(client, ip_addr):
    resp = await client.get(f"{DEVICE42_HOST}/api/1.0/ips/", params={"ip": ip_addr})
    resp.raise_for_status()
    entries = resp.json().get("ips", [])
    if not entries:
        return False, None
    entry = entries[0]
    device_name = entry.get("device")
    in_use = bool(device_name) and (entry.get("available") or "no").lower() != "yes"
    return in_use, device_name if in_use else None


async def main():
    await connect_to_mongo()
    db = get_database()
    ip_repo = IPRecordRepository(db["ip_records"])

    cursor = db["ip_records"].find({
        "$or": [{"created_by": "zabbix-sync"}, {"updated_by": "zabbix-sync"}]
    })
    touched = await cursor.to_list(length=None)
    log.info("records touched by zabbix-sync today: %d", len(touched))

    plan = {"keep_ok": 0, "keep_device42_confirmed": 0, "delete": 0, "manual_review": 0}
    to_delete = []
    to_update = []
    manual_review = []

    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {ZABBIX_TOKEN}"}, verify=False, timeout=15.0,
    ) as zbx_client, httpx.AsyncClient(
        auth=(DEVICE42_USER, DEVICE42_PASS), verify=False, timeout=15.0,
    ) as d42_client:
        for rec in touched:
            ip_addr = rec["ip_address"]
            found, status, stale = await zabbix_host_state(zbx_client, ip_addr)

            if not found or status != "1" or not stale:
                plan["keep_ok"] += 1
                continue

            # stale+disabled — bug-affected. Cross-check Device42.
            in_use, device_name = await device42_confirms(d42_client, ip_addr)
            if in_use:
                plan["keep_device42_confirmed"] += 1
                to_update.append({
                    "id": rec["_id"],
                    "ip": ip_addr,
                    "hostname": device_name,
                    "description": f"Reconciled: Device42-confirmed (Zabbix host disabled & stale >6mo)",
                })
                continue

            if rec.get("created_by") == "zabbix-sync":
                plan["delete"] += 1
                to_delete.append({"id": rec["_id"], "ip": ip_addr, "hostname": rec.get("hostname")})
            else:
                plan["manual_review"] += 1
                manual_review.append({
                    "ip": ip_addr,
                    "hostname": rec.get("hostname"),
                    "created_by": rec.get("created_by"),
                    "current_status": rec.get("status"),
                })

    log.info("=== PLAN === %s", plan)
    log.info("--- to DELETE (%d) ---", len(to_delete))
    for row in to_delete:
        log.info("  DELETE %s (%s)", row["ip"], row["hostname"])
    log.info("--- to UPDATE / Device42-confirmed (%d) ---", len(to_update))
    for row in to_update:
        log.info("  KEEP+relabel %s -> %s", row["ip"], row["hostname"])
    log.info("--- MANUAL REVIEW needed (%d) ---", len(manual_review))
    for row in manual_review:
        log.info("  REVIEW %s hostname=%s created_by=%s current_status=%s",
                  row["ip"], row["hostname"], row["created_by"], row["current_status"])

    if not APPLY:
        log.info("=== DRY RUN — set APPLY=1 to actually delete/update ===")
        await close_mongo_connection()
        return

    deleted = 0
    for row in to_delete:
        await db["ip_records"].delete_one({"_id": row["id"]})
        deleted += 1
    updated = 0
    for row in to_update:
        now = datetime.now(timezone.utc)
        await db["ip_records"].update_one(
            {"_id": row["id"]},
            {"$set": {
                "hostname": row["hostname"],
                "description": row["description"],
                "updated_by": "zabbix-reconcile",
                "updated_at": now,
            }},
        )
        updated += 1

    log.info("=== APPLIED: deleted=%d updated=%d ===", deleted, updated)
    await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())

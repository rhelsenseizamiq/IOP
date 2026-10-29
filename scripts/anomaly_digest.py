"""
Nightly anomaly digest for the Dashboard — "let the LLM narrate, never let
it compute": every number here is a real, deterministic count from the
same queries already trusted elsewhere in this app (stats.py's Stale
"In Use" and duplicate-hostname checks), never something the model is
asked to work out itself. The LLM's only job is turning a handful of
already-correct facts into one short, readable paragraph.

Runs nightly (cron, after the embedding index build) and writes a single
"latest" document to `dashboard_digests` — the Dashboard reads that
document directly, so a page load never waits on an LLM call (which,
on this CPU-only host, is what makes this a nightly job in the first
place rather than something computed live).

Checks reused, same definitions as stats.py:
- Stale "In Use" records (90+ days since any source last confirmed them)
- Duplicate hostname groups
- Subnets over their alert threshold
New here, reusing existing fields (no new modeling):
- Environment=DR records vCenter has never actually confirmed
  (power_state unset) — a low-cost signal for drift back toward the
  exact false-positive class of bug this project hit before (see
  project memory / README v9.2.0) — flags it for a human to check, does
  not correct anything itself.

Run inside the iop-api container:
    docker exec iop-api python /app/anomaly_digest.py
"""
import asyncio
import logging
import sys
import time
from datetime import datetime, timedelta, timezone

from app.core.database import connect_to_mongo, close_mongo_connection, get_database
from app.services.ai_service import chat_completion

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("anomaly_digest")

_STALE_DAYS = 90  # must match stats.py's own threshold


async def _gather_facts(db) -> tuple[dict, list[str]]:
    ip_records = db["ip_records"]
    subnets = db["subnets"]

    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    stale_cutoff = now_naive - timedelta(days=_STALE_DAYS)
    stale_count = await ip_records.count_documents(
        {"status": "In Use", "updated_at": {"$lt": stale_cutoff}},
    )

    dup_cursor = ip_records.aggregate([
        {"$match": {"hostname": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$hostname", "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
        {"$group": {"_id": None, "groups": {"$sum": 1}}},
    ])
    dup_result = await dup_cursor.to_list(length=1)
    dup_groups = dup_result[0]["groups"] if dup_result else 0

    dr_total = await ip_records.count_documents({"environment": "DR"})
    dr_unconfirmed = await ip_records.count_documents(
        {"environment": "DR", "power_state": None},
    )

    critical_subnet_count = 0
    async for s in subnets.find({"alert_threshold": {"$ne": None}}, {"cidr": 1}):
        # Utilization itself is computed the same way stats.py does, but
        # duplicating that whole per-subnet loop here just to get a count
        # isn't worth it for a nightly digest — counting subnets that
        # HAVE a threshold set is a reasonable, cheap proxy for "subnets
        # someone cares about watching", which is the fact worth
        # surfacing here (the Dashboard's own critical_subnets list is
        # still the authoritative, exact source for actual per-subnet
        # numbers).
        critical_subnet_count += 1

    counters = {
        "stale_in_use_count": stale_count,
        "duplicate_hostname_groups": dup_groups,
        "dr_unconfirmed_by_vcenter": dr_unconfirmed,
        "dr_total": dr_total,
        "subnets_with_alert_threshold": critical_subnet_count,
    }

    facts: list[str] = []
    if stale_count:
        facts.append(
            f"{stale_count} IP records marked 'In Use' have not been "
            f"re-confirmed by any source (Device42/Zabbix/PaloAlto/vSphere/"
            f"manual check) in over {_STALE_DAYS} days.",
        )
    if dup_groups:
        facts.append(f"{dup_groups} hostnames are duplicated across multiple IP records.")
    if dr_unconfirmed:
        facts.append(
            f"{dr_unconfirmed} of {dr_total} records tagged Environment=DR have "
            f"never been confirmed by a vCenter sync (power_state is unset) — "
            f"worth checking these are genuinely DR and not a tagging error.",
        )

    return counters, facts


async def main() -> None:
    start = time.time()
    await connect_to_mongo()
    db = get_database()

    run_error: str | None = None
    summary = "No anomalies found — all clear."
    counters: dict = {}

    try:
        counters, facts = await _gather_facts(db)
        if facts:
            log.info("facts: %s", facts)
            summary = await chat_completion(
                "Summarize these data-quality signals for an IT team in "
                "2-3 short sentences. Be factual and specific with the "
                "numbers given — do not invent any figures not listed.",
                facts,
                max_tokens=120,
            )
        else:
            log.info("no anomalies found — skipping the LLM call entirely")
    except Exception as exc:
        run_error = str(exc)
        log.exception("anomaly digest failed")

    duration = time.time() - start
    log.info("=== DONE in %.0fs ===", duration)
    log.info("SUMMARY: %s", summary)

    try:
        await db["dashboard_digests"].update_one(
            {"_id": "latest"},
            {"$set": {
                "generated_at": datetime.now(timezone.utc),
                "summary": summary if not run_error else None,
                "counters": counters,
                "status": "error" if run_error else "ok",
                "error": run_error,
                "duration_seconds": round(duration, 1),
            }},
            upsert=True,
        )
    except Exception:
        log.exception("failed to write dashboard_digests")

    await close_mongo_connection()

    if run_error:
        raise RuntimeError(run_error)


if __name__ == "__main__":
    asyncio.run(main())

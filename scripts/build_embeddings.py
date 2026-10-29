"""
Nightly embedding indexer for the offline AI assistant.

Builds a short text blurb for every subnet and embeds it with the local
nomic-embed-text model (via Ollama, running natively on the host — see
ai_service.py), storing the vector in the `record_embeddings` collection.
This is what lets the assistant answer questions grounded in this IPAM's
actual data instead of hallucinating.

SCOPE — subnets only, not IP records (deliberate, not a TODO): this
host's CPU (Xeon E5-2670, ~2012 — no AVX2/FMA) measured ~17-19s per
single embedding call. At that rate, indexing the full IP-records fleet
(tens of thousands of records) would take many hours — doesn't fit a
nightly window and would pin all 8 cores on the same VM serving live
IPAM traffic for most of the night. Subnets (~1,400 records) is a
one-time backfill of a few hours, then genuinely fast nightly incremental
runs once most are unchanged (see the updated_at skip below). Revisit
indexing IP records too if this workload ever moves to modern-CPU
hardware — see the "no AVX2" finding in project memory / README.

Vault password entries are NEVER indexed here, regardless of scope —
secrets must not enter the embedding/LLM pipeline, even offline.

Re-embedding is skipped for any record whose `updated_at` hasn't changed
since the last run (tracked in each embedding doc's metadata) — avoids
re-calling the model for records that haven't actually changed.

Run inside the iop-api container:
    docker exec iop-api python /app/build_embeddings.py
"""
import asyncio
import logging
import sys
import time
from datetime import datetime, timezone

from app.core.database import connect_to_mongo, close_mongo_connection, get_database
from app.repositories.embedding_repository import EmbeddingRepository
from app.services.ai_service import embed_text

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("build_embeddings")

# Ollama is configured with OLLAMA_NUM_PARALLEL=1 on this CPU-only host
# (parallel requests wouldn't add real throughput, just queuing overhead
# and premature timeout risk) — concurrency here matches that reality
# rather than pretending to parallelize.
_CONCURRENCY = 1


def _subnet_blurb(doc: dict) -> str:
    parts = [f"Subnet {doc['cidr']} ({doc.get('name', '')})", f"— {doc.get('environment', 'Production')}."]
    if doc.get("vlan_id"):
        parts.append(f"VLAN {doc['vlan_id']}.")
    if doc.get("gateway"):
        parts.append(f"Gateway {doc['gateway']}.")
    if doc.get("alert_threshold"):
        parts.append(f"Alert threshold {doc['alert_threshold']}%.")
    if doc.get("description"):
        parts.append(doc["description"])
    return " ".join(parts)


async def _index_collection(
    source_collection: str,
    blurb_fn,
    db,
    repo: EmbeddingRepository,
    counters: dict,
    extra_ctx: dict | None = None,
) -> None:
    existing_updated_at: dict[str, str] = {}
    async for emb_doc in db["record_embeddings"].find(
        {"source_collection": source_collection}, {"source_id": 1, "metadata.record_updated_at": 1}
    ):
        existing_updated_at[emb_doc["source_id"]] = emb_doc.get("metadata", {}).get("record_updated_at")

    keep_ids: list[str] = []
    sem = asyncio.Semaphore(_CONCURRENCY)

    async def _process(doc: dict) -> None:
        doc_id = str(doc["_id"])
        keep_ids.append(doc_id)
        updated_at_str = str(doc.get("updated_at", ""))
        counters[f"{source_collection}_seen"] += 1

        if existing_updated_at.get(doc_id) == updated_at_str:
            counters[f"{source_collection}_unchanged"] += 1
            return

        # Everything below is guarded as one block — a single malformed
        # document (bad blurb_fn input) or a transient Mongo write error
        # must not abort the whole run; every other sync script in this
        # codebase isolates per-record failures the same way, this one
        # originally didn't (only the embed_text call was guarded), which
        # meant one bad subnet document could silently stop the entire
        # nightly index build.
        try:
            text = blurb_fn(doc, **(extra_ctx or {}))
            async with sem:
                vector = await embed_text(text)
            await repo.upsert(
                source_collection=source_collection,
                source_id=doc_id,
                text=text,
                embedding=vector,
                metadata={
                    "record_updated_at": updated_at_str,
                    "ip_address": doc.get("ip_address"),
                    "cidr": doc.get("cidr"),
                },
            )
            counters[f"{source_collection}_embedded"] += 1
        except Exception as exc:
            counters[f"{source_collection}_errors"] += 1
            log.warning(
                "embed/upsert failed for %s %s: %s: %s",
                source_collection, doc_id, type(exc).__name__, exc,
            )

    tasks = []
    async for doc in db[source_collection].find({}):
        tasks.append(asyncio.create_task(_process(doc)))
    if tasks:
        await asyncio.gather(*tasks)

    # Safety net: delete_missing's Mongo query is `source_id: {"$nin":
    # keep_ids}` — if keep_ids is empty (e.g. a transient read hiccup
    # returned zero documents rather than the collection genuinely being
    # empty), "$nin: []" matches EVERY document, which would wipe every
    # embedding for this collection instead of just the truly-deleted
    # ones. A real collection with ~1,400 subnets suddenly yielding zero
    # is a strong signal something's wrong, not that they were all
    # deleted — skip cleanup rather than risk mass data loss on a fluke.
    if not keep_ids:
        log.warning(
            "%s: find({}) returned zero documents — skipping delete_missing "
            "as a safety net (would otherwise delete every embedding for "
            "this collection)",
            source_collection,
        )
    else:
        removed = await repo.delete_missing(source_collection, keep_ids)
        counters[f"{source_collection}_removed"] = removed


async def main() -> None:
    start = time.time()
    await connect_to_mongo()
    db = get_database()
    repo = EmbeddingRepository(db["record_embeddings"])

    counters = {
        "subnets_seen": 0, "subnets_embedded": 0, "subnets_unchanged": 0, "subnets_errors": 0,
    }
    run_error: str | None = None

    try:
        log.info("=== indexing subnets ===")
        # IP records are NOT indexed — see the module docstring for why
        # (too slow on this CPU at fleet scale). Vault password entries are
        # NEVER indexed regardless of scope — secrets must not enter the
        # embedding/LLM pipeline, even offline.
        await _index_collection("subnets", _subnet_blurb, db, repo, counters)
    except Exception as exc:
        run_error = str(exc)
        log.exception("embedding build failed")

    duration = time.time() - start
    log.info("=== DONE in %.0fs ===", duration)
    log.info("FINAL COUNTERS: %s", counters)
    log.info("total embeddings stored: %d", await repo.count())

    try:
        await db["sync_status"].update_one(
            {"_id": "ai_embeddings"},
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


if __name__ == "__main__":
    asyncio.run(main())

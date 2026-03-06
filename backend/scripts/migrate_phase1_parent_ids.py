#!/usr/bin/env python3
"""
Migration: Phase 1 — Set parent_id and prefix_len for all existing subnets.

Run once after deploying Phase 1 backend changes:
    cd backend && python -m scripts.migrate_phase1_parent_ids

Idempotent: safe to run multiple times.
"""
import asyncio
import ipaddress
import logging
import sys
from pathlib import Path

# Allow running from the backend directory
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.database import close_mongo_connection, connect_to_mongo, get_database

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def run_migration() -> None:
    await connect_to_mongo()
    db = get_database()
    subnets_col = db["subnets"]

    # Load all subnets
    cursor = subnets_col.find({})
    all_docs = await cursor.to_list(length=None)
    logger.info("Found %d subnets to process", len(all_docs))

    parsed = []
    for doc in all_docs:
        try:
            net = ipaddress.ip_network(doc["cidr"], strict=False)
            parsed.append(
                {
                    "id": doc["_id"],
                    "cidr": doc["cidr"],
                    "network": net,
                    "prefix_len": net.prefixlen,
                    "vrf_id": doc.get("vrf_id"),
                }
            )
        except ValueError:
            logger.warning("Skipping invalid CIDR: %s", doc.get("cidr"))

    updated = 0
    for subnet in parsed:
        best_parent = None
        best_prefix_len = -1

        for candidate in parsed:
            if candidate["id"] == subnet["id"]:
                continue
            # Must be in the same VRF scope
            if candidate["vrf_id"] != subnet["vrf_id"]:
                continue
            # Candidate must be a larger block that contains this subnet
            if (
                candidate["prefix_len"] < subnet["prefix_len"]
                and subnet["network"].subnet_of(candidate["network"])
                and candidate["prefix_len"] > best_prefix_len
            ):
                best_parent = candidate
                best_prefix_len = candidate["prefix_len"]

        parent_id_str = str(best_parent["id"]) if best_parent else None

        result = await subnets_col.update_one(
            {"_id": subnet["id"]},
            {
                "$set": {
                    "parent_id": parent_id_str,
                    "prefix_len": subnet["prefix_len"],
                }
            },
        )
        if result.modified_count:
            updated += 1

    logger.info(
        "Migration complete: %d / %d subnets updated (parent_id + prefix_len)",
        updated,
        len(parsed),
    )
    await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(run_migration())

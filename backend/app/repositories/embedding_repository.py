"""
Stores/searches text embeddings for the offline AI assistant, in the
`record_embeddings` collection. Deliberately NOT a vector database — this
MongoDB (community edition, self-hosted) has no native vector search
(that's an Atlas-only feature), and adding one (numpy + faiss/etc.) isn't
possible here: the running container's image can't be rebuilt on this
no-internet host, so any new Python dependency has to be avoidable rather
than hot-installed.

Instead, similarity search is a MongoDB aggregation: embeddings are
L2-normalized at write time (see ai_service.embed_text), so a plain dot
product between the stored vector and the query vector IS the cosine
similarity. $zip + $map + $multiply + $sum computes that dot product
per-document, in MongoDB's own (C++) aggregation engine — fast enough at
this record count without an external vector index, and needs nothing
beyond the Motor driver already in use everywhere else in this codebase.
"""
from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorCollection


class EmbeddingRepository:
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        self._col = collection

    async def upsert(
        self,
        source_collection: str,
        source_id: str,
        text: str,
        embedding: list[float],
        metadata: dict,
    ) -> None:
        await self._col.update_one(
            {"source_collection": source_collection, "source_id": source_id},
            {
                "$set": {
                    "text": text,
                    "embedding": embedding,
                    "metadata": metadata,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )

    async def delete_missing(self, source_collection: str, keep_ids: list[str]) -> int:
        """Removes embeddings for records that no longer exist (deleted
        since the last indexing run)."""
        result = await self._col.delete_many({
            "source_collection": source_collection,
            "source_id": {"$nin": keep_ids},
        })
        return result.deleted_count

    async def search(
        self,
        query_vector: list[float],
        top_k: int = 8,
        source_collections: Optional[list[str]] = None,
    ) -> list[dict]:
        match_stage: dict = {}
        if source_collections:
            match_stage["source_collection"] = {"$in": source_collections}

        pipeline: list[dict] = []
        if match_stage:
            pipeline.append({"$match": match_stage})
        pipeline += [
            {
                "$addFields": {
                    "score": {
                        "$sum": {
                            "$map": {
                                "input": {"$zip": {"inputs": ["$embedding", query_vector]}},
                                "as": "pair",
                                "in": {"$multiply": [
                                    {"$arrayElemAt": ["$$pair", 0]},
                                    {"$arrayElemAt": ["$$pair", 1]},
                                ]},
                            }
                        }
                    }
                }
            },
            {"$sort": {"score": -1}},
            {"$limit": top_k},
            {"$project": {"_id": 0, "text": 1, "metadata": 1, "score": 1,
                           "source_collection": 1, "source_id": 1}},
        ]
        cursor = self._col.aggregate(pipeline)
        return await cursor.to_list(length=top_k)

    async def count(self) -> int:
        return await self._col.count_documents({})

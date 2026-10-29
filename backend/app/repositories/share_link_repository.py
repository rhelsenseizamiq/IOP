from typing import Optional
from motor.motor_asyncio import AsyncIOMotorCollection
from pymongo import ReturnDocument

from app.models.share_link import ShareLink
from app.repositories.base import BaseRepository


class ShareLinkRepository(BaseRepository[ShareLink]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, ShareLink)

    async def find_by_token(self, token: str) -> Optional[ShareLink]:
        doc = await self._col.find_one({"token": token})
        return self._doc_to_model(doc) if doc else None

    async def find_for_resource(self, resource_type: str, resource_id: str) -> list[ShareLink]:
        cursor = self._col.find({"resource_type": resource_type, "resource_id": resource_id})
        docs = await cursor.to_list(length=None)
        return [self._doc_to_model(doc) for doc in docs]

    async def find_for_owner(self, created_by: str, active_only: bool = False) -> list[ShareLink]:
        filter_: dict = {"created_by": created_by}
        if active_only:
            filter_["is_revoked"] = False
        cursor = self._col.find(filter_)
        docs = await cursor.to_list(length=None)
        return [self._doc_to_model(doc) for doc in docs]

    async def try_consume_view(self, token: str) -> Optional[ShareLink]:
        """Atomically increments view_count iff the link is still usable
        (not revoked, under its max_views) — the single source of truth for
        "can this use proceed", so two concurrent requests against the same
        max_views: 1 link can never both succeed. Returns the updated
        document on success, None if the link doesn't exist or is no longer
        usable (caller still needs to separately check expiry — expiry is
        time-based, not a field this atomic Mongo update can race-check
        against "now" meaningfully beyond what the caller already verified)."""
        # max_views == 0 means unlimited (see ShareLinkCreate) — allow the
        # consume unconditionally in that case, same as _peek_usable's gate.
        doc = await self._col.find_one_and_update(
            {
                "token": token,
                "is_revoked": False,
                "$expr": {
                    "$or": [
                        {"$eq": ["$max_views", 0]},
                        {"$lt": ["$view_count", "$max_views"]},
                    ]
                },
            },
            {"$inc": {"view_count": 1}},
            return_document=ReturnDocument.AFTER,
        )
        return self._doc_to_model(doc) if doc else None

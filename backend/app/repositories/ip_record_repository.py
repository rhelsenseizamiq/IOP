from typing import Optional
from motor.motor_asyncio import AsyncIOMotorCollection

from app.models.ip_record import IPRecord, IPStatus
from app.repositories.base import BaseRepository


class IPRecordRepository(BaseRepository[IPRecord]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, IPRecord)

    async def find_by_ip(self, ip_address: str) -> Optional[IPRecord]:
        doc = await self._col.find_one({"ip_address": ip_address})
        return self._doc_to_model(doc) if doc else None

    async def find_by_ip_and_vrf(
        self, ip_address: str, vrf_id: Optional[str]
    ) -> Optional[IPRecord]:
        """VRF-scoped IP lookup (vrf_id=None means global scope)."""
        doc = await self._col.find_one({"ip_address": ip_address, "vrf_id": vrf_id})
        return self._doc_to_model(doc) if doc else None

    async def find_by_subnet(
        self,
        subnet_id: str,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[IPRecord], int]:
        filter_ = {"subnet_id": subnet_id}
        return await self.find_all(filter_, skip=skip, limit=limit)

    async def count_by_subnet_and_status(self, subnet_id: str) -> dict:
        """Returns counts by status for the given subnet."""
        pipeline = [
            {"$match": {"subnet_id": subnet_id}},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        ]
        cursor = self._col.aggregate(pipeline)
        results = await cursor.to_list(length=None)
        counts: dict = {
            IPStatus.FREE.value: 0,
            IPStatus.RESERVED.value: 0,
            IPStatus.IN_USE.value: 0,
        }
        for row in results:
            status_key = row["_id"]
            if status_key in counts:
                counts[status_key] = row["count"]
        return counts

    async def count_by_status_for_subnets(self, subnet_ids: list[str]) -> dict[str, dict]:
        """Returns {subnet_id: {"Free": N, "Reserved": N, "In Use": N}} for all given subnet IDs."""
        if not subnet_ids:
            return {}
        pipeline = [
            {"$match": {"subnet_id": {"$in": subnet_ids}}},
            {"$group": {
                "_id": {"subnet_id": "$subnet_id", "status": "$status"},
                "count": {"$sum": 1},
            }},
        ]
        cursor = self._col.aggregate(pipeline)
        results = await cursor.to_list(length=None)
        empty = {IPStatus.FREE.value: 0, IPStatus.RESERVED.value: 0, IPStatus.IN_USE.value: 0}
        counts: dict[str, dict] = {}
        for row in results:
            sid = row["_id"]["subnet_id"]
            status_key = row["_id"]["status"]
            if sid not in counts:
                counts[sid] = dict(empty)
            if status_key in counts[sid]:
                counts[sid][status_key] = row["count"]
        return counts

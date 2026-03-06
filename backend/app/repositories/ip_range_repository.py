from typing import Optional
from motor.motor_asyncio import AsyncIOMotorCollection

from app.models.ip_range import IPRange
from app.repositories.base import BaseRepository


class IPRangeRepository(BaseRepository[IPRange]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, IPRange)

    async def find_by_subnet(
        self, subnet_id: str, skip: int = 0, limit: int = 50
    ) -> tuple[list[IPRange], int]:
        return await self.find_all({"subnet_id": subnet_id}, skip=skip, limit=limit)

    async def find_overlapping(
        self,
        subnet_id: str,
        start_int: int,
        end_int: int,
        exclude_id: Optional[str] = None,
    ) -> Optional[IPRange]:
        """Returns the first IP range in the subnet that overlaps [start_int, end_int]."""
        query: dict = {
            "subnet_id": subnet_id,
            "start_int": {"$lte": end_int},
            "end_int": {"$gte": start_int},
        }
        if exclude_id:
            from bson import ObjectId
            try:
                query["_id"] = {"$ne": ObjectId(exclude_id)}
            except Exception:
                pass
        doc = await self._col.find_one(query)
        return self._doc_to_model(doc) if doc else None

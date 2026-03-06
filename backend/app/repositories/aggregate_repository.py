from typing import Optional
from motor.motor_asyncio import AsyncIOMotorCollection

from app.models.aggregate import Aggregate
from app.repositories.base import BaseRepository


class AggregateRepository(BaseRepository[Aggregate]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, Aggregate)

    async def find_by_prefix(self, prefix: str) -> Optional[Aggregate]:
        doc = await self._col.find_one({"prefix": prefix})
        return self._doc_to_model(doc) if doc else None

    async def find_all_by_rir(self, rir_id: str) -> list[Aggregate]:
        cursor = self._col.find({"rir_id": rir_id})
        docs = await cursor.to_list(length=None)
        return [self._doc_to_model(doc) for doc in docs]

    async def count_by_rir(self, rir_id: str) -> int:
        return await self._col.count_documents({"rir_id": rir_id})

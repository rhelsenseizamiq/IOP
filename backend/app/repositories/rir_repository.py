from typing import Optional
from motor.motor_asyncio import AsyncIOMotorCollection

from app.models.rir import RIR
from app.repositories.base import BaseRepository


class RIRRepository(BaseRepository[RIR]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, RIR)

    async def find_by_name(self, name: str) -> Optional[RIR]:
        doc = await self._col.find_one({"name": name})
        return self._doc_to_model(doc) if doc else None

    async def find_by_slug(self, slug: str) -> Optional[RIR]:
        doc = await self._col.find_one({"slug": slug})
        return self._doc_to_model(doc) if doc else None

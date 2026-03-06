from typing import Optional
from motor.motor_asyncio import AsyncIOMotorCollection

from app.models.vrf import VRF
from app.repositories.base import BaseRepository


class VRFRepository(BaseRepository[VRF]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, VRF)

    async def find_by_name(self, name: str) -> Optional[VRF]:
        doc = await self._col.find_one({"name": name})
        return self._doc_to_model(doc) if doc else None

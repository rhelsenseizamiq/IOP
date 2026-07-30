from motor.motor_asyncio import AsyncIOMotorCollection

from app.models.folder import Folder
from app.repositories.base import BaseRepository


class FolderRepository(BaseRepository[Folder]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, Folder)

    async def find_by_cabinet(self, cabinet_id: str) -> list[Folder]:
        cursor = self._col.find({"cabinet_id": cabinet_id}).sort("name", 1)
        docs = await cursor.to_list(length=None)
        return [self._doc_to_model(doc) for doc in docs]

    async def find_by_name_in_parent(
        self, cabinet_id: str, parent_id: str | None, name: str
    ) -> Folder | None:
        filter_ = {"cabinet_id": cabinet_id, "name": name,
                   "parent_id": parent_id}
        doc = await self._col.find_one(filter_)
        return self._doc_to_model(doc) if doc else None

    async def delete_by_cabinet(self, cabinet_id: str) -> int:
        result = await self._col.delete_many({"cabinet_id": cabinet_id})
        return result.deleted_count

from datetime import datetime
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorCollection

from app.models.file import FileEntry
from app.repositories.base import BaseRepository


class FileRepository(BaseRepository[FileEntry]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, FileEntry)

    async def find_expired(self, now: datetime) -> list[FileEntry]:
        cursor = self._col.find({"expires_at": {"$ne": None, "$lt": now}})
        docs = await cursor.to_list(length=None)
        return [self._doc_to_model(doc) for doc in docs]

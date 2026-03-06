from typing import Optional
from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId

from app.models.subnet import Subnet
from app.repositories.base import BaseRepository


class SubnetRepository(BaseRepository[Subnet]):
    def __init__(self, collection: AsyncIOMotorCollection) -> None:
        super().__init__(collection, Subnet)

    async def find_by_cidr(self, cidr: str, vrf_id: Optional[str] = None) -> Optional[Subnet]:
        doc = await self._col.find_one({"cidr": cidr, "vrf_id": vrf_id})
        return self._doc_to_model(doc) if doc else None

    async def find_all_in_vrf(self, vrf_id: Optional[str] = None) -> list[Subnet]:
        """Returns ALL subnets in a given VRF (no pagination) for tree building."""
        cursor = self._col.find({"vrf_id": vrf_id})
        docs = await cursor.to_list(length=None)
        return [self._doc_to_model(doc) for doc in docs]

    async def find_children(self, parent_id: str) -> list[Subnet]:
        """Returns direct children of a subnet."""
        cursor = self._col.find({"parent_id": parent_id})
        docs = await cursor.to_list(length=None)
        return [self._doc_to_model(doc) for doc in docs]

    async def find_potential_parents(
        self, prefix_len: int, vrf_id: Optional[str] = None
    ) -> list[Subnet]:
        """Subnets with a shorter prefix length (larger blocks) in the same VRF."""
        query = {"prefix_len": {"$lt": prefix_len}, "vrf_id": vrf_id}
        cursor = self._col.find(query)
        docs = await cursor.to_list(length=None)
        return [self._doc_to_model(doc) for doc in docs]

    async def reparent_subnets(self, subnet_ids: list[str], new_parent_id: str) -> None:
        """Update parent_id for a list of subnets."""
        oids = [ObjectId(sid) for sid in subnet_ids]
        await self._col.update_many(
            {"_id": {"$in": oids}},
            {"$set": {"parent_id": new_parent_id}},
        )

    async def count_by_vrf(self, vrf_id: str) -> int:
        return await self._col.count_documents({"vrf_id": vrf_id})

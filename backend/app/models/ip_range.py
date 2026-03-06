from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict


class IPRange(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    subnet_id: str
    vrf_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    start_address: str
    end_address: str
    start_int: int   # denormalized for overlap detection
    end_int: int     # denormalized for overlap detection
    size: int        # end_int - start_int + 1
    status: str = "Active"   # Active | Reserved | Deprecated
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    updated_by: str = "system"

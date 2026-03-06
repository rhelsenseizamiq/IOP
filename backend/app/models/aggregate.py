from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict


class Aggregate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    prefix: str           # CIDR notation
    prefix_len: int       # denormalized from CIDR
    rir_id: str           # FK → RIR
    description: Optional[str] = None
    date_added: Optional[str] = None  # YYYY-MM-DD string
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    updated_by: str = "system"

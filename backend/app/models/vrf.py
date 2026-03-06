from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict


class VRF(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    name: str
    rd: Optional[str] = None          # route distinguisher e.g. "65000:1"
    description: Optional[str] = None
    enforce_unique: bool = True        # enforce IP uniqueness within this VRF
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    updated_by: str = "system"

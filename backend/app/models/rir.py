from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict


class RIR(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    name: str
    slug: str
    description: Optional[str] = None
    is_private: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    updated_by: str = "system"

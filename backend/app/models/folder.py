from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class Folder(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    cabinet_id: str
    parent_id: Optional[str] = None
    name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str
    updated_by: str

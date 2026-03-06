from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class RIRCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z0-9_-]+$")
    description: Optional[str] = Field(None, max_length=500)
    is_private: bool = False


class RIRUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    is_private: Optional[bool] = None


class RIRResponse(BaseModel):
    id: str
    name: str
    slug: str
    description: Optional[str]
    is_private: bool
    aggregate_count: int = 0
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str

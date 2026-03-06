from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class VRFCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    rd: Optional[str] = Field(None, max_length=50, description='Route distinguisher, e.g. "65000:1"')
    description: Optional[str] = Field(None, max_length=500)
    enforce_unique: bool = True


class VRFUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    rd: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, max_length=500)
    enforce_unique: Optional[bool] = None


class VRFResponse(BaseModel):
    id: str
    name: str
    rd: Optional[str]
    description: Optional[str]
    enforce_unique: bool
    subnet_count: int = 0
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str

import re
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator

_NAME_RE = re.compile(r"^[\w\s\-\.]+$")


class FolderCreate(BaseModel):
    cabinet_id: str
    parent_id: Optional[str] = None
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError("Folder name may only contain letters, digits, spaces, hyphens, underscores, and dots")
        return v


class FolderUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError("Folder name may only contain letters, digits, spaces, hyphens, underscores, and dots")
        return v


class FolderResponse(BaseModel):
    id: str
    cabinet_id: str
    parent_id: Optional[str]
    name: str
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str

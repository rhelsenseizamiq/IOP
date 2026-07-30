from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class PasswordEntryCreate(BaseModel):
    cabinet_id: str
    folder_id: Optional[str] = None
    title: str = Field(min_length=1, max_length=200)
    username: Optional[str] = Field(default=None, max_length=200)
    password: str = Field(min_length=1, max_length=1000)
    url: Optional[str] = Field(default=None, max_length=2048)
    notes: Optional[str] = Field(default=None, max_length=5000)
    tags: list[str] = Field(default_factory=list, max_length=20)

    def model_post_init(self, __context) -> None:
        for tag in self.tags:
            if len(tag) > 50:
                raise ValueError(f"Each tag must be at most 50 characters, got {len(tag)!r}")


class PasswordEntryUpdate(BaseModel):
    folder_id: Optional[str] = Field(default=None)
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    username: Optional[str] = Field(default=None, max_length=200)
    password: Optional[str] = Field(default=None, min_length=1, max_length=1000)
    url: Optional[str] = Field(default=None, max_length=2048)
    notes: Optional[str] = Field(default=None, max_length=5000)
    tags: Optional[list[str]] = Field(default=None, max_length=20)

    def model_post_init(self, __context) -> None:
        if self.tags is not None:
            for tag in self.tags:
                if len(tag) > 50:
                    raise ValueError(f"Each tag must be at most 50 characters, got {len(tag)!r}")


class PasswordMoveRequest(BaseModel):
    folder_id: Optional[str] = None


class PasswordEntryResponse(BaseModel):
    id: str
    cabinet_id: str
    folder_id: Optional[str]
    title: str
    username: Optional[str]
    url: Optional[str]
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str


class PasswordEntryDetailResponse(PasswordEntryResponse):
    notes: Optional[str]


class RevealResponse(BaseModel):
    password: str

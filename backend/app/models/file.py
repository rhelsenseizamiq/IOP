from typing import Optional
from datetime import datetime, timezone
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict, field_validator


class ScanStatus(str, Enum):
    PENDING = "pending"
    CLEAN = "clean"
    INFECTED = "infected"
    SCAN_FAILED = "scan_failed"


class FileVisibility(str, Enum):
    ORG = "org"
    OWNER_ONLY = "owner_only"


class FileEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    filename: str
    content_type: str
    size_bytes: int
    # Null until the scan comes back clean and the file is actually encrypted
    # into permanent storage — see core/file_vault.py and services/file_service.py.
    storage_path: Optional[str] = None
    wrapped_dek: Optional[str] = None
    dek_iv: Optional[str] = None
    file_iv: Optional[str] = None
    sha256: str
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    scan_status: ScanStatus = ScanStatus.PENDING
    visibility: FileVisibility = FileVisibility.ORG
    delete_after_first_download: bool = False
    expires_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    updated_by: str = "system"

    # Same fix as ShareLink._assume_naive_is_utc — Mongo hands back naive
    # datetimes on read, so a comparison against datetime.now(timezone.utc)
    # (e.g. the nightly TTL cleanup job reading expires_at) would otherwise
    # raise TypeError instead of comparing cleanly.
    @field_validator("expires_at", "created_at", "updated_at", mode="after")
    @classmethod
    def _assume_naive_is_utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

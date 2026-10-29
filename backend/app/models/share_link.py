from typing import Optional
from datetime import datetime, timezone
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict, field_validator


class ShareResourceType(str, Enum):
    PASSWORD_ENTRY = "password_entry"
    FILE = "file"


class ShareLinkType(str, Enum):
    DOWNLOAD = "download"
    UPLOAD = "upload"


class ShareLink(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    token: str
    link_type: ShareLinkType = ShareLinkType.DOWNLOAD
    resource_type: ShareResourceType
    # Null for an upload-type link until its one allowed upload actually lands.
    resource_id: Optional[str] = None
    expires_at: Optional[datetime] = None
    # Kept as max_views/view_count (not renamed to something more generic like
    # "max_uses") specifically so the already-built password-sharing frontend
    # contract (ShareModal.tsx's ShareLink interface) doesn't need to change —
    # for an upload-type link this just counts uploads instead of views.
    max_views: int = 1
    view_count: int = 0
    note: Optional[str] = None
    is_revoked: bool = False
    # Optional extra passphrase on top of the token itself (bcrypt hash,
    # reusing app.core.password's hash_password/verify_password — never the
    # raw passphrase, never stored anywhere else).
    password_hash: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    updated_by: str = "system"

    # PyMongo/Motor hand back naive datetimes on read (the client isn't
    # configured tz_aware, and BSON UTC datetime carries no tzinfo) even
    # though every write here goes in via datetime.now(timezone.utc) — so a
    # value round-tripped through Mongo loses its tzinfo and a later
    # `datetime.now(timezone.utc) > link.expires_at` raises TypeError
    # instead of producing a clean comparison. Normalize once, here, so
    # every caller gets a tz-aware value regardless of whether it came from
    # a fresh ShareLinkCreate or a document loaded back out of the DB.
    @field_validator("expires_at", "created_at", "updated_at", mode="after")
    @classmethod
    def _assume_naive_is_utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

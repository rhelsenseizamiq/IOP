from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from app.models.share_link import ShareLinkType, ShareResourceType


class ShareLinkCreate(BaseModel):
    expires_in_hours: Optional[int] = Field(default=None, ge=1, le=8760)  # up to 1 year
    # Ignored (always treated as 1) for an upload-type link — see
    # ShareLink.max_views's own docstring in app/models/share_link.py.
    max_views: int = Field(default=0, ge=0)
    note: Optional[str] = Field(default=None, max_length=500)
    password: Optional[str] = Field(default=None, min_length=4, max_length=200)


class ShareLinkResponse(BaseModel):
    id: str
    share_url: str
    link_type: ShareLinkType
    resource_type: ShareResourceType
    expires_at: Optional[datetime]
    max_views: int
    view_count: int
    note: Optional[str]
    is_revoked: bool
    has_password: bool
    created_at: datetime
    created_by: str


class SharedPasswordResponse(BaseModel):
    resource_type: str = "password_entry"
    entry_title: str
    username: Optional[str]
    password: str
    url: Optional[str]
    note: Optional[str]
    expires_at: Optional[datetime]
    view_count: int
    max_views: int


class SharedFileResponse(BaseModel):
    resource_type: str = "file"
    file_id: str
    filename: str
    size_bytes: int
    content_type: str
    note: Optional[str]
    expires_at: Optional[datetime]
    view_count: int
    max_views: int


class SharePasswordUnlockRequest(BaseModel):
    password: str


class UploadRequestCreate(BaseModel):
    expires_in_hours: Optional[int] = Field(default=None, ge=1, le=8760)
    note: Optional[str] = Field(default=None, max_length=500)
    password: Optional[str] = Field(default=None, min_length=4, max_length=200)


class UploadLinkInfo(BaseModel):
    """What the public upload page can know BEFORE a file is submitted —
    deliberately minimal, no resource content exists yet for an upload
    link. Lets the frontend show a password prompt or an "already used"
    state without needing to attempt a real upload first."""
    valid: bool
    has_password: bool
    note: Optional[str]
    expires_at: Optional[datetime]

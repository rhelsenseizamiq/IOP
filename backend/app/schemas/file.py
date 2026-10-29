from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from app.models.file import FileVisibility, ScanStatus


class FileUpdate(BaseModel):
    description: Optional[str] = Field(default=None, max_length=2000)
    tags: Optional[list[str]] = Field(default=None, max_length=20)


class FileResponse(BaseModel):
    id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    description: Optional[str]
    tags: list[str]
    scan_status: ScanStatus
    visibility: FileVisibility
    delete_after_first_download: bool
    expires_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str
    # Never includes wrapped_dek/dek_iv/file_iv/storage_path — those stay
    # server-side only, see app/models/file.py.

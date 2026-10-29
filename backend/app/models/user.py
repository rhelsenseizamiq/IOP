from enum import Enum
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict, field_validator


class Role(str, Enum):
    VIEWER = "Viewer"
    OPERATOR = "Operator"
    ADMINISTRATOR = "Administrator"
    SUPER_ADMIN = "SuperAdmin"


class User(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    username: str
    password_hash: str
    full_name: str
    email: Optional[str] = None
    role: Role
    is_active: bool = True
    auth_type: str = "local"
    approval_status: str = "approved"
    registration_note: Optional[str] = None
    rejection_reason: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    last_login: Optional[datetime] = None
    # Account-level brute-force lockout (independent of the per-IP rate
    # limit on the login route) — see app/services/auth_service.py::login()
    # and security review 2026-10-29. Both default so existing user
    # documents (which predate these fields) validate fine with no
    # migration needed.
    failed_login_count: int = 0
    locked_until: Optional[datetime] = None

    # Same fix as ShareLink/FileEntry's _assume_naive_is_utc — Mongo hands
    # back naive datetimes on read, so a later `datetime.now(timezone.utc)
    # < user.locked_until` would otherwise raise TypeError the first time
    # an account actually gets locked.
    @field_validator("locked_until", mode="after")
    @classmethod
    def _assume_naive_is_utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class UserInToken(BaseModel):
    sub: str
    role: Role
    full_name: str
    jti: str

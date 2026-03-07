from enum import Enum
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict


class Role(str, Enum):
    VIEWER = "Viewer"
    OPERATOR = "Operator"
    ADMINISTRATOR = "Administrator"


class User(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    username: str
    password_hash: str  # NEVER included in response schemas; empty string for LDAP users
    full_name: str
    email: Optional[str] = None
    role: Role
    is_active: bool = True
    auth_type: str = "local"  # "local" or "ldap"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    last_login: Optional[datetime] = None


class UserInToken(BaseModel):
    sub: str  # username
    role: Role
    full_name: str
    jti: str

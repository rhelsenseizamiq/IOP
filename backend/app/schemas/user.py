from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, EmailStr, field_validator

from app.models.user import Role


def _empty_str_to_none(v: object) -> object:
    if isinstance(v, str) and not v.strip():
        return None
    return v


class UserCreate(BaseModel):
    username: str = Field(
        ...,
        min_length=3,
        max_length=50,
        pattern=r'^[a-zA-Z0-9_.-]+$',
        description='Alphanumeric, underscores, dots, and hyphens only',
    )
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=100)
    email: Optional[EmailStr] = None
    role: Role

    _normalise_email = field_validator('email', mode='before')(_empty_str_to_none)


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[EmailStr] = None
    role: Optional[Role] = None

    _normalise_email = field_validator('email', mode='before')(_empty_str_to_none)


class UserResetPassword(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: str
    username: str
    full_name: str
    email: Optional[str]
    role: Role
    is_active: bool
    auth_type: str = 'local'
    approval_status: str = 'approved'
    registration_note: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    created_by: str
    last_login: Optional[datetime]

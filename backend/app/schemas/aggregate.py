import ipaddress
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class AggregateCreate(BaseModel):
    prefix: str = Field(..., description="Network in CIDR notation, e.g. 10.0.0.0/8")
    rir_id: str
    description: Optional[str] = Field(None, max_length=500)
    date_added: Optional[str] = Field(None, description="YYYY-MM-DD")

    @field_validator("prefix")
    @classmethod
    def validate_prefix(cls, v: str) -> str:
        try:
            ipaddress.ip_network(v, strict=False)
        except ValueError as exc:
            raise ValueError(f"Invalid CIDR notation: {v}") from exc
        return v


class AggregateUpdate(BaseModel):
    rir_id: Optional[str] = None
    description: Optional[str] = Field(None, max_length=500)
    date_added: Optional[str] = None


class AggregateResponse(BaseModel):
    id: str
    prefix: str
    prefix_len: int
    rir_id: str
    rir_name: str = ""
    description: Optional[str]
    date_added: Optional[str]
    contained_prefix_count: int = 0
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str

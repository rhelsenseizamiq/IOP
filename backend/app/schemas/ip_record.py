import ipaddress
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

from app.models.ip_record import OSType, IPStatus, Environment


class BulkActionRequest(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=500)


class BulkUpdateRequest(BulkActionRequest):
    environment: Optional[Environment] = None
    owner: Optional[str] = Field(None, max_length=100)
    os_type: Optional[OSType] = None


class IPRecordCreate(BaseModel):
    ip_address: str = Field(..., description="Valid IPv4 address")
    hostname: Optional[str] = Field(None, max_length=253)
    os_type: OSType
    subnet_id: str = Field(..., description="MongoDB ObjectId string of the parent subnet")
    status: IPStatus = IPStatus.FREE
    environment: Environment
    owner: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)

    @field_validator("ip_address")
    @classmethod
    def validate_ipv4(cls, v: str) -> str:
        try:
            addr = ipaddress.ip_address(v)
            if not isinstance(addr, ipaddress.IPv4Address):
                raise ValueError("Only IPv4 addresses are supported")
        except ValueError as exc:
            raise ValueError(f"Invalid IPv4 address: {v}") from exc
        return v


class IPRecordUpdate(BaseModel):
    hostname: Optional[str] = Field(None, max_length=253)
    os_type: Optional[OSType] = None
    status: Optional[IPStatus] = None
    environment: Optional[Environment] = None
    owner: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class IPRecordResponse(BaseModel):
    id: str
    ip_address: str
    hostname: Optional[str]
    os_type: OSType
    subnet_id: str
    status: IPStatus
    environment: Environment
    owner: Optional[str]
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str
    reserved_at: Optional[datetime]
    reserved_by: Optional[str]

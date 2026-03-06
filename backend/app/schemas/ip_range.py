import ipaddress
from typing import Literal, Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator, model_validator


IP_RANGE_STATUS = Literal["Active", "Reserved", "Deprecated"]


def _ip_to_int(ip: str) -> int:
    return int(ipaddress.ip_address(ip))


class IPRangeCreate(BaseModel):
    subnet_id: str
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    start_address: str
    end_address: str
    status: IP_RANGE_STATUS = "Active"

    @field_validator("start_address", "end_address")
    @classmethod
    def validate_ip(cls, v: str) -> str:
        try:
            addr = ipaddress.ip_address(v)
            if not isinstance(addr, ipaddress.IPv4Address):
                raise ValueError("Only IPv4 addresses are supported")
        except ValueError as exc:
            raise ValueError(f"Invalid IPv4 address: {v}") from exc
        return v

    @model_validator(mode="after")
    def validate_range_order(self) -> "IPRangeCreate":
        if _ip_to_int(self.start_address) > _ip_to_int(self.end_address):
            raise ValueError("start_address must be less than or equal to end_address")
        return self


class IPRangeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    start_address: Optional[str] = None
    end_address: Optional[str] = None
    status: Optional[IP_RANGE_STATUS] = None

    @field_validator("start_address", "end_address")
    @classmethod
    def validate_ip(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            try:
                addr = ipaddress.ip_address(v)
                if not isinstance(addr, ipaddress.IPv4Address):
                    raise ValueError("Only IPv4 addresses are supported")
            except ValueError as exc:
                raise ValueError(f"Invalid IPv4 address: {v}") from exc
        return v


class IPRangeResponse(BaseModel):
    id: str
    subnet_id: str
    vrf_id: Optional[str]
    name: str
    description: Optional[str]
    start_address: str
    end_address: str
    size: int
    status: str
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str

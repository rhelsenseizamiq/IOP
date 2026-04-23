from typing import Optional

from pydantic import BaseModel, Field


class Device42DiscoverRequest(BaseModel):
    host: str = Field(..., description="Device42 hostname or IP")
    username: str
    password: str
    verify_ssl: bool = False
    limit: int = Field(default=2000, ge=1, le=10000)


class Device42IP(BaseModel):
    ip_address: str
    hostname: Optional[str] = None
    device_name: Optional[str] = None
    os_type: str = "Unknown"
    subnet: Optional[str] = None
    mac_address: Optional[str] = None
    label: Optional[str] = None
    available: bool = False


class Device42ImportIP(BaseModel):
    ip_address: str
    subnet_id: str
    hostname: Optional[str] = None
    os_type: str = "Unknown"
    environment: str = "Production"
    device_name: Optional[str] = None


class Device42ImportRequest(BaseModel):
    ips: list[Device42ImportIP] = Field(..., min_length=1)


class Device42ImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[str]

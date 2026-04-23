from typing import Optional

from pydantic import BaseModel, Field


class PaloAltoDiscoverRequest(BaseModel):
    host: str = Field(..., description="PaloAlto hostname or IP")
    username: str
    password: str
    verify_ssl: bool = False


class PaloAltoAddress(BaseModel):
    name: str
    ip_netmask: Optional[str] = None
    ip_range: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = []
    address_type: str = "ip-netmask"


class PaloAltoInterface(BaseModel):
    name: str
    ip_address: Optional[str] = None
    zone: Optional[str] = None
    state: str = "unknown"


class PaloAltoDiscoverResult(BaseModel):
    addresses: list[PaloAltoAddress]
    interfaces: list[PaloAltoInterface]
    arp_entries: list[dict]


class PaloAltoImportAddress(BaseModel):
    ip_address: str
    subnet_id: str
    hostname: Optional[str] = None
    os_type: str = "Unknown"
    environment: str = "Production"
    description: Optional[str] = None


class PaloAltoImportRequest(BaseModel):
    addresses: list[PaloAltoImportAddress] = Field(..., min_length=1)


class PaloAltoImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[str]

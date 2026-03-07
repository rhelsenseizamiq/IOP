from typing import Optional
from pydantic import BaseModel, Field


class VsphereDiscoverRequest(BaseModel):
    host: str = Field(..., description="vCenter hostname or IP")
    username: str
    password: str
    datacenter: Optional[str] = None
    verify_ssl: bool = False


class VsphereIPInfo(BaseModel):
    address: str
    version: int  # 4 or 6


class VsphereVM(BaseModel):
    name: str
    guest_hostname: Optional[str] = None
    ip_addresses: list[VsphereIPInfo] = []
    os_type: str = "Unknown"
    power_state: str = "unknown"
    datacenter: Optional[str] = None
    cluster: Optional[str] = None


class VsphereImportVM(BaseModel):
    vm_name: str
    ip_address: str
    subnet_id: str
    hostname: Optional[str] = None
    os_type: str = "Unknown"
    environment: str = "Production"


class VsphereImportRequest(BaseModel):
    vms: list[VsphereImportVM] = Field(..., min_length=1)


class VsphereImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[str]

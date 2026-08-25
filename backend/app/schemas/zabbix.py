from typing import Optional

from pydantic import BaseModel, Field


class ZabbixDiscoverRequest(BaseModel):
    limit: int = Field(default=2000, ge=1, le=10000)


class ZabbixHost(BaseModel):
    ip_address: str
    hostname: Optional[str] = None
    device_name: Optional[str] = None
    zabbix_status: str = "enabled"  # "enabled" | "disabled" monitoring
    available: bool = False  # Zabbix's live interface reachability at discover time


class ZabbixImportIP(BaseModel):
    ip_address: str
    subnet_id: str
    hostname: Optional[str] = None
    environment: str = "Production"
    device_name: Optional[str] = None


class ZabbixImportRequest(BaseModel):
    ips: list[ZabbixImportIP] = Field(..., min_length=1)


class ZabbixImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[str]

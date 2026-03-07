import ipaddress
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

from app.models.ip_record import Environment


class SubnetCreate(BaseModel):
    cidr: str = Field(..., description="Network in CIDR notation, e.g. 192.168.1.0/24")
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    gateway: Optional[str] = Field(None, description="Gateway IPv4 address within the subnet")
    vlan_id: Optional[int] = Field(None, ge=1, le=4094)
    environment: Environment
    parent_id: Optional[str] = None
    vrf_id: Optional[str] = None
    alert_threshold: Optional[int] = Field(None, ge=1, le=100)

    @field_validator("cidr")
    @classmethod
    def validate_cidr(cls, v: str) -> str:
        try:
            ipaddress.ip_network(v, strict=False)
        except ValueError as exc:
            raise ValueError(f"Invalid CIDR notation: {v}") from exc
        return v

    @field_validator("gateway")
    @classmethod
    def validate_gateway(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            try:
                ipaddress.ip_address(v)
            except ValueError as exc:
                raise ValueError(f"Invalid gateway IP address: {v}") from exc
        return v


class SubnetUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    gateway: Optional[str] = None
    vlan_id: Optional[int] = Field(None, ge=1, le=4094)
    environment: Optional[Environment] = None
    vrf_id: Optional[str] = None
    alert_threshold: Optional[int] = Field(None, ge=1, le=100)

    @field_validator("gateway")
    @classmethod
    def validate_gateway(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            try:
                ipaddress.ip_address(v)
            except ValueError as exc:
                raise ValueError(f"Invalid gateway IP address: {v}") from exc
        return v


class SubnetResponse(BaseModel):
    id: str
    cidr: str
    name: str
    description: Optional[str]
    gateway: Optional[str]
    vlan_id: Optional[int]
    environment: Environment
    parent_id: Optional[str] = None
    vrf_id: Optional[str] = None
    prefix_len: int = 0
    depth: int = 0
    is_container: bool = False
    child_prefix_count: int = 0
    alert_threshold: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str


class SubnetDetailResponse(SubnetResponse):
    total_ips: int
    used_ips: int
    free_ips: int
    reserved_ips: int
    alert_threshold: Optional[int] = None


class SubnetTreeNode(SubnetDetailResponse):
    children: list["SubnetTreeNode"] = Field(default_factory=list)
    key: str = ""
    utilization_pct: float = 0.0


SubnetTreeNode.model_rebuild()

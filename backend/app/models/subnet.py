from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict

from app.models.ip_record import Environment


class Subnet(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    cidr: str
    name: str
    description: Optional[str] = None
    gateway: Optional[str] = None
    vlan_id: Optional[int] = None
    environment: Environment
    parent_id: Optional[str] = None   # ObjectId of parent subnet; None = root
    vrf_id: Optional[str] = None      # ObjectId of VRF; None = global
    prefix_len: int = 0               # denormalized from CIDR for fast MongoDB queries
    alert_threshold: Optional[int] = None  # 1-100; alert when utilization >= this value
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    updated_by: str = "system"

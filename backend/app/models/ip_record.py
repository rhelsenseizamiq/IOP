from enum import Enum
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict


class OSType(str, Enum):
    AIX = "AIX"
    LINUX = "Linux"
    WINDOWS = "Windows"
    MACOS = "macOS"
    OPENSHIFT = "OpenShift"
    UNKNOWN = "Unknown"


class IPStatus(str, Enum):
    FREE = "Free"
    RESERVED = "Reserved"
    IN_USE = "In Use"


class Environment(str, Enum):
    PRODUCTION = "Production"
    TEST = "Test"
    DEVELOPMENT = "Development"


class IPRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    ip_address: str
    hostname: Optional[str] = None
    os_type: OSType
    subnet_id: str
    vrf_id: Optional[str] = None
    status: IPStatus = IPStatus.FREE
    environment: Environment
    owner: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"
    updated_by: str = "system"
    reserved_at: Optional[datetime] = None
    reserved_by: Optional[str] = None

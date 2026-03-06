from enum import Enum
from typing import Optional, Any
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict


class AuditAction(str, Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    RESERVE = "RESERVE"
    RELEASE = "RELEASE"
    LOGIN = "LOGIN"
    LOGOUT = "LOGOUT"
    LOGIN_FAILED = "LOGIN_FAILED"
    PASSWORD_RESET = "PASSWORD_RESET"


class ResourceType(str, Enum):
    IP_RECORD = "ip_record"
    SUBNET = "subnet"
    USER = "user"
    AUTH = "auth"
    VRF = "vrf"
    RIR = "rir"
    AGGREGATE = "aggregate"
    IP_RANGE = "ip_range"


class AuditLog(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = Field(default=None, alias="_id")
    action: AuditAction
    resource_type: ResourceType
    resource_id: Optional[str] = None
    username: str
    user_role: str
    client_ip: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    before: Optional[dict[str, Any]] = None
    after: Optional[dict[str, Any]] = None
    detail: Optional[str] = None

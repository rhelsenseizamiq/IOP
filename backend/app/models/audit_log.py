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
    REVEAL = "REVEAL"
    REGISTER = "REGISTER"
    APPROVE = "APPROVE"
    REJECT = "REJECT"
    # File sharing (see app/services/file_service.py / share_service.py)
    UPLOAD = "UPLOAD"
    DOWNLOAD = "DOWNLOAD"
    SHARE_CREATE = "SHARE_CREATE"
    SHARE_VIEW = "SHARE_VIEW"
    SHARE_REVOKE = "SHARE_REVOKE"
    MALWARE_DETECTED = "MALWARE_DETECTED"


class ResourceType(str, Enum):
    IP_RECORD = "ip_record"
    SUBNET = "subnet"
    USER = "user"
    AUTH = "auth"
    VRF = "vrf"
    RIR = "rir"
    AGGREGATE = "aggregate"
    IP_RANGE = "ip_range"
    CABINET = "cabinet"
    PASSWORD_ENTRY = "password_entry"
    ASSET = "asset"
    FILE = "file"
    SHARE_LINK = "share_link"


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

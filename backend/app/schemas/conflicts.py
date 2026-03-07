from datetime import datetime
from typing import Literal
from pydantic import BaseModel


ConflictType = Literal[
    "FORWARD_MISMATCH",
    "PTR_MISMATCH",
    "NO_FORWARD",
    "DUPLICATE_HOSTNAME",
]


class ConflictItem(BaseModel):
    ip_address: str
    hostname: str
    conflict_type: ConflictType
    detail: str


class ConflictReport(BaseModel):
    subnet_id: str
    scanned_at: datetime
    total_checked: int
    conflicts: list[ConflictItem]

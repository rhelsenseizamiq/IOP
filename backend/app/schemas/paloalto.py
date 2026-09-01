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


class PaloAltoCheckRequest(BaseModel):
    ip_address: str


class PaloAltoCheckBulkRequest(BaseModel):
    cidr: Optional[str] = None
    ip_addresses: Optional[list[str]] = None


class PaloAltoCheckMatch(BaseModel):
    host: str
    address_name: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = []
    ip_netmask: Optional[str] = None
    mac: Optional[str] = None
    interface: Optional[str] = None
    zone: Optional[str] = None
    arp_status: Optional[str] = None
    ttl: Optional[str] = None


class PaloAltoNatMatch(BaseModel):
    host: str
    rule_name: str
    roles: list[str]
    from_zones: list[str] = []
    to_zones: list[str] = []
    original_source: list[str] = []
    original_destination: list[str] = []
    translated_source: Optional[str] = None
    translated_destination: Optional[str] = None
    disabled: bool = False


class PaloAltoSecurityMatch(BaseModel):
    host: str
    rule_name: str
    roles: list[str]
    action: str
    from_zones: list[str] = []
    to_zones: list[str] = []
    source: list[str] = []
    destination: list[str] = []
    applications: list[str] = []
    services: list[str] = []
    tags: list[str] = []
    disabled: bool = False


class PaloAltoCheckResult(BaseModel):
    ip_address: str
    found: bool
    hostname: Optional[str] = None
    matches: list[PaloAltoCheckMatch]
    nat_matches: list[PaloAltoNatMatch] = []
    security_matches: list[PaloAltoSecurityMatch] = []
    security_matches_total: int = 0
    log: list[str] = []
    errors: list[str] = []


class PaloAltoSaveRequest(BaseModel):
    ip_address: str


class PaloAltoSaveResult(BaseModel):
    action: str  # "created" | "updated"
    ip_record_id: str
    subnet_cidr: str
    hostname: Optional[str] = None
    status: str


class PaloAltoBulkSaveRequest(BaseModel):
    ip_addresses: list[str] = Field(..., min_length=1)


class PaloAltoBulkSaveResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str] = []


class PaloAltoCheckLogEntry(BaseModel):
    ip_address: str
    found: bool
    hostname: Optional[str] = None
    log: list[str]
    matches_count: int
    nat_matches_count: int
    security_matches_total: int
    source: str
    checked_by: str
    checked_at: str


class PaloAltoRuleHit(BaseModel):
    rule_name: str
    rule_type: str  # "security" | "nat"
    hit_count: int


class PaloAltoScanSubnetResult(BaseModel):
    subnet_cidr: str
    scanned: int
    found: int
    created: int
    updated: int
    skipped: int
    utilization_pct: float
    errors: list[str] = []
    # Which PAN-OS security/NAT rules were actually matched by addresses in
    # this subnet, most-referenced first — reuses match data already fetched
    # during the scan (no extra PAN-OS calls), so it's essentially free.
    top_rules: list[PaloAltoRuleHit] = []


class PaloAltoTrafficLogRequest(BaseModel):
    ip_address: str
    days: int = 30


class PaloAltoTrafficLogEntry(BaseModel):
    host: str
    time_generated: str
    src: str
    dst: str
    sport: Optional[int] = None
    dport: Optional[int] = None
    proto: Optional[str] = None
    app: Optional[str] = None
    action: Optional[str] = None
    rule: Optional[str] = None
    from_zone: Optional[str] = None
    to_zone: Optional[str] = None
    bytes: Optional[int] = None
    bytes_sent: Optional[int] = None
    bytes_received: Optional[int] = None
    elapsed: Optional[int] = None
    session_end_reason: Optional[str] = None


class PaloAltoTrafficLogResult(BaseModel):
    ip_address: str
    days: int
    entries: list[PaloAltoTrafficLogEntry]
    truncated: bool = False
    errors: list[str] = []

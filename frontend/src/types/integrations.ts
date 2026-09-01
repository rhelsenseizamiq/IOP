// ── vSphere ────────────────────────────────────────────────────────────────────

export interface VsphereDiscoverRequest {
  host: string;
  username: string;
  password: string;
  datacenter?: string;
  verify_ssl?: boolean;
}

export interface VsphereIPInfo {
  address: string;
  version: 4 | 6;
}

export interface VsphereVM {
  name: string;
  guest_hostname: string | null;
  ip_addresses: VsphereIPInfo[];
  os_type: string;
  power_state: string;
  datacenter: string | null;
  cluster: string | null;
}

export interface VsphereImportVM {
  vm_name: string;
  ip_address: string;
  subnet_id: string;
  hostname?: string;
  os_type?: string;
  environment?: string;
}

export interface VsphereImportRequest {
  vms: VsphereImportVM[];
}

export interface VsphereImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

// ── Device42 ──────────────────────────────────────────────────────────────────

export interface Device42DiscoverRequest {
  host: string;
  username: string;
  password: string;
  verify_ssl?: boolean;
  limit?: number;
}

export interface Device42IP {
  ip_address: string;
  hostname: string | null;
  device_name: string | null;
  os_type: string;
  subnet: string | null;
  mac_address: string | null;
  label: string | null;
  available: boolean;
}

export interface Device42ImportIP {
  ip_address: string;
  subnet_id: string;
  hostname?: string;
  os_type?: string;
  environment?: string;
  device_name?: string;
}

export interface Device42ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

// ── Zabbix ────────────────────────────────────────────────────────────────────
// Credentials are server-configured only — never sent from the browser.

export interface ZabbixDiscoverRequest {
  limit?: number;
}

export interface ZabbixHost {
  ip_address: string;
  hostname: string | null;
  device_name: string | null;
  zabbix_status: string; // "enabled" | "disabled"
  available: boolean;
}

export interface ZabbixImportIP {
  ip_address: string;
  subnet_id: string;
  hostname?: string;
  environment?: string;
  device_name?: string;
}

export interface ZabbixImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

// ── PaloAlto ──────────────────────────────────────────────────────────────────

export interface PaloAltoDiscoverRequest {
  host: string;
  username: string;
  password: string;
  verify_ssl?: boolean;
}

export interface PaloAltoAddress {
  name: string;
  ip_netmask: string | null;
  ip_range: string | null;
  description: string | null;
  tags: string[];
  address_type: string;
}

export interface PaloAltoInterface {
  name: string;
  ip_address: string | null;
  zone: string | null;
  state: string;
}

export interface PaloAltoArpEntry {
  ip: string;
  mac: string;
  interface: string;
  status: string;
  ttl: string;
}

export interface PaloAltoDiscoverResult {
  addresses: PaloAltoAddress[];
  interfaces: PaloAltoInterface[];
  arp_entries: PaloAltoArpEntry[];
}

export interface PaloAltoImportAddress {
  ip_address: string;
  subnet_id: string;
  hostname?: string;
  os_type?: string;
  environment?: string;
  description?: string;
}

export interface PaloAltoImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

// ── Ping / availability ───────────────────────────────────────────────────────

export interface PingResult {
  ip_address: string;
  reachable: boolean;
  method: string;
  latency_ms: number | null;
  status_updated: boolean;
  new_status: string | null;
  scan_source: string | null;
  device_name: string | null;
}

export type ScanSource =
  | "ens192"
  | "ens224"
  | "device42"
  | "zabbix"
  | "paloalto";

// ── PaloAlto Check tab ──────────────────────────────────────────────────────

export interface PaloAltoCheckMatch {
  host: string;
  address_name: string | null;
  description: string | null;
  tags: string[];
  ip_netmask: string | null;
  mac: string | null;
  interface: string | null;
  zone: string | null;
  arp_status: string | null;
  ttl: string | null;
}

export interface PaloAltoNatMatch {
  host: string;
  rule_name: string;
  roles: string[];
  from_zones: string[];
  to_zones: string[];
  original_source: string[];
  original_destination: string[];
  translated_source: string | null;
  translated_destination: string | null;
  disabled: boolean;
}

export interface PaloAltoSecurityMatch {
  host: string;
  rule_name: string;
  roles: string[];
  action: string;
  from_zones: string[];
  to_zones: string[];
  source: string[];
  destination: string[];
  applications: string[];
  services: string[];
  tags: string[];
  disabled: boolean;
}

export interface PaloAltoCheckResult {
  ip_address: string;
  found: boolean;
  hostname: string | null;
  matches: PaloAltoCheckMatch[];
  nat_matches: PaloAltoNatMatch[];
  security_matches: PaloAltoSecurityMatch[];
  security_matches_total: number;
  log: string[];
  errors: string[];
}

export interface PaloAltoSaveResult {
  action: "created" | "updated";
  ip_record_id: string;
  subnet_cidr: string;
  hostname: string | null;
  status: string;
}

export interface PaloAltoBulkSaveResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface PaloAltoRuleHit {
  rule_name: string;
  rule_type: "security" | "nat";
  hit_count: number;
}

export interface PaloAltoScanSubnetResult {
  subnet_cidr: string;
  scanned: number;
  found: number;
  created: number;
  updated: number;
  skipped: number;
  utilization_pct: number;
  errors: string[];
  top_rules: PaloAltoRuleHit[];
}

export interface PaloAltoCheckLogEntry {
  ip_address: string;
  found: boolean;
  hostname: string | null;
  log: string[];
  matches_count: number;
  nat_matches_count: number;
  security_matches_total: number;
  source: string;
  checked_by: string;
  checked_at: string;
}

export interface PaloAltoTrafficLogEntry {
  host: string;
  time_generated: string;
  src: string;
  dst: string;
  sport: number | null;
  dport: number | null;
  proto: string | null;
  app: string | null;
  action: string | null;
  rule: string | null;
  from_zone: string | null;
  to_zone: string | null;
  bytes: number | null;
  bytes_sent: number | null;
  bytes_received: number | null;
  elapsed: number | null;
  session_end_reason: string | null;
}

export interface PaloAltoTrafficLogResult {
  ip_address: string;
  days: number;
  entries: PaloAltoTrafficLogEntry[];
  truncated: boolean;
  errors: string[];
}

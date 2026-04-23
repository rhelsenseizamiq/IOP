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
}

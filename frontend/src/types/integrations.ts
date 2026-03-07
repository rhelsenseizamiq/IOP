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

import apiClient from './client';

export type ScanMode = 'quick' | 'standard' | 'deep';

export interface ScanModeInfo {
  key: ScanMode;
  label: string;
  description: string;
  detail: string;
  maxHosts: number;
  maxCidr: string;
  osDetect: boolean;
  hostname: boolean;
  ports: number;
  color: string;
}

export const SCAN_MODES: ScanModeInfo[] = [
  {
    key: 'quick',
    label: 'Quick',
    description: 'Host discovery only',
    detail: '4 ports checked • No OS detection • No hostname lookup',
    maxHosts: 4094,
    maxCidr: '/20',
    osDetect: false,
    hostname: false,
    ports: 4,
    color: '#52c41a',
  },
  {
    key: 'standard',
    label: 'Standard',
    description: 'Balanced — OS + hostname',
    detail: '14 ports checked • OS detection • Hostname lookup',
    maxHosts: 1022,
    maxCidr: '/22',
    osDetect: true,
    hostname: true,
    ports: 14,
    color: '#1677ff',
  },
  {
    key: 'deep',
    label: 'Deep',
    description: 'Full port coverage',
    detail: '35 ports checked • Full OS detection • Hostname lookup • Open ports list',
    maxHosts: 254,
    maxCidr: '/24',
    osDetect: true,
    hostname: true,
    ports: 35,
    color: '#722ed1',
  },
];

export interface ScanRequest {
  cidr: string;
  mode: ScanMode;
}

export interface DiscoveredHost {
  ip_address: string;
  hostname: string | null;
  os_hint: string | null;
  open_ports: number[];
}

export interface ScanResult {
  cidr: string;
  mode: string;
  total_scanned: number;
  discovered: DiscoveredHost[];
  duration_seconds: number;
}

export interface DiscoverScanRequest {
  cidrs: string[];
  mode: ScanMode;
  save_inactive: boolean;
  overwrite_status: boolean;
}

export interface DiscoverScanResult {
  total_scanned: number;
  total_discovered: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  duration_seconds: number;
}

export const scanApi = {
  scan: (data: ScanRequest) =>
    apiClient.post<ScanResult>('/scan', data),

  discover: (data: DiscoverScanRequest) =>
    apiClient.post<DiscoverScanResult>('/scan/discover', data),
};

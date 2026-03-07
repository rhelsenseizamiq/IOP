import type { Environment } from './ipRecord';

export interface Subnet {
  id: string;
  cidr: string;
  name: string;
  description: string | null;
  gateway: string | null;
  vlan_id: number | null;
  environment: Environment;
  parent_id: string | null;
  vrf_id: string | null;
  prefix_len: number;
  depth: number;
  is_container: boolean;
  child_prefix_count: number;
  alert_threshold: number | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface SubnetDetail extends Subnet {
  total_ips: number;
  used_ips: number;
  free_ips: number;
  reserved_ips: number;
}

export interface SubnetTreeNode extends SubnetDetail {
  children: SubnetTreeNode[];
  key: string;
  utilization_pct: number;
}

export interface SubnetCreate {
  cidr: string;
  name: string;
  description?: string;
  gateway?: string;
  vlan_id?: number;
  environment: Environment;
  parent_id?: string;
  vrf_id?: string;
  alert_threshold?: number;
}

export interface SubnetUpdate {
  name?: string;
  description?: string;
  gateway?: string;
  vlan_id?: number;
  environment?: Environment;
  vrf_id?: string;
  alert_threshold?: number;
}

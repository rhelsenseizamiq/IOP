export type OSType = 'AIX' | 'Linux' | 'Windows' | 'macOS' | 'OpenShift' | 'Unknown';
export type IPStatus = 'Free' | 'Reserved' | 'In Use';
export type Environment =
  | 'Production'
  | 'Staging'
  | 'UAT'
  | 'QA'
  | 'Test'
  | 'Development'
  | 'DR'
  | 'Lab';

export interface IPRecord {
  id: string;
  ip_address: string;
  hostname: string | null;
  os_type: OSType;
  subnet_id: string;
  status: IPStatus;
  environment: Environment;
  owner: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  reserved_at: string | null;
  reserved_by: string | null;
}

export interface IPRecordCreate {
  ip_address: string;
  hostname?: string;
  os_type: OSType;
  subnet_id: string;
  status?: IPStatus;
  environment: Environment;
  owner?: string;
  description?: string;
}

export interface IPRecordUpdate {
  hostname?: string;
  os_type?: OSType;
  status?: IPStatus;
  environment?: Environment;
  owner?: string;
  description?: string;
}

export interface IPRecordFilters {
  subnet_id?: string;
  status?: IPStatus;
  os_type?: OSType;
  environment?: Environment;
  owner?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

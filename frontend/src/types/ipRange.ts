export type IPRangeStatus = 'Active' | 'Reserved' | 'Deprecated';

export interface IPRange {
  id: string;
  subnet_id: string;
  vrf_id: string | null;
  name: string;
  description: string | null;
  start_address: string;
  end_address: string;
  size: number;
  status: IPRangeStatus;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface IPRangeCreate {
  subnet_id: string;
  name: string;
  description?: string;
  start_address: string;
  end_address: string;
  status?: IPRangeStatus;
}

export interface IPRangeUpdate {
  name?: string;
  description?: string;
  start_address?: string;
  end_address?: string;
  status?: IPRangeStatus;
}

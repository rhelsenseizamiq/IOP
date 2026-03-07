export type ConflictType =
  | 'FORWARD_MISMATCH'
  | 'PTR_MISMATCH'
  | 'NO_FORWARD'
  | 'DUPLICATE_HOSTNAME';

export interface ConflictItem {
  ip_address: string;
  hostname: string;
  conflict_type: ConflictType;
  detail: string;
}

export interface ConflictReport {
  subnet_id: string;
  scanned_at: string;
  total_checked: number;
  conflicts: ConflictItem[];
}

export interface Aggregate {
  id: string;
  prefix: string;
  prefix_len: number;
  rir_id: string;
  rir_name: string;
  description: string | null;
  date_added: string | null;
  contained_prefix_count: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface AggregateCreate {
  prefix: string;
  rir_id: string;
  description?: string;
  date_added?: string;
}

export interface AggregateUpdate {
  rir_id?: string;
  description?: string;
  date_added?: string;
}

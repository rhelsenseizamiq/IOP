export interface RIR {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_private: boolean;
  aggregate_count: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface RIRCreate {
  name: string;
  slug: string;
  description?: string;
  is_private?: boolean;
}

export interface RIRUpdate {
  name?: string;
  description?: string;
  is_private?: boolean;
}

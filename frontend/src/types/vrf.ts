export interface VRF {
  id: string;
  name: string;
  rd: string | null;
  description: string | null;
  enforce_unique: boolean;
  subnet_count: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface VRFCreate {
  name: string;
  rd?: string;
  description?: string;
  enforce_unique?: boolean;
}

export interface VRFUpdate {
  name?: string;
  rd?: string;
  description?: string;
  enforce_unique?: boolean;
}

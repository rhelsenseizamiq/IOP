export interface Cabinet {
  id: string;
  name: string;
  description: string | null;
  member_usernames: string[];
  entry_count: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface Folder {
  id: string;
  cabinet_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface PasswordEntry {
  id: string;
  cabinet_id: string;
  folder_id: string | null;
  title: string;
  username: string | null;
  url: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface PasswordEntryDetail extends PasswordEntry {
  notes: string | null;
}

export interface CabinetCreate {
  name: string;
  description?: string;
  member_usernames?: string[];
}

export interface CabinetUpdate {
  name?: string;
  description?: string;
}

export interface FolderCreate {
  cabinet_id: string;
  parent_id?: string | null;
  name: string;
}

export interface FolderUpdate {
  name: string;
}

export interface PasswordEntryCreate {
  cabinet_id: string;
  folder_id?: string | null;
  title: string;
  username?: string;
  password: string;
  url?: string;
  notes?: string;
  tags?: string[];
}

export interface PasswordEntryUpdate {
  folder_id?: string | null;
  title?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  tags?: string[];
}

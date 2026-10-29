export type ScanStatus = "pending" | "clean" | "infected" | "scan_failed";
export type FileVisibility = "org" | "owner_only";

export interface FileEntry {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  description: string | null;
  tags: string[];
  scan_status: ScanStatus;
  visibility: FileVisibility;
  delete_after_first_download: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface FileUploadMeta {
  description?: string;
  tags?: string[];
  delete_after_first_download?: boolean;
  // Required — the uploader must explicitly choose when their own file
  // gets deleted (max 30 days out; enforced again server-side).
  expires_at: string;
}

export interface FileUpdate {
  description?: string;
  tags?: string[];
}

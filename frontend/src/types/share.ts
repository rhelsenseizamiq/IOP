// Generic share-link types — used by both the Vault's password-sharing
// modal and the new Files feature's sharing/upload-request UI. Backend:
// app/schemas/share_link.py.

export type ShareLinkType = "download" | "upload";
export type ShareResourceType = "password_entry" | "file";

export interface ShareLink {
  id: string;
  share_url: string;
  link_type: ShareLinkType;
  resource_type: ShareResourceType;
  expires_at: string | null;
  max_views: number;
  view_count: number;
  note: string | null;
  is_revoked: boolean;
  has_password: boolean;
  created_at: string;
  created_by: string;
}

export interface ShareLinkCreate {
  expires_in_hours?: number | null;
  max_views?: number;
  note?: string | null;
  password?: string | null;
}

export interface UploadRequestCreate {
  expires_in_hours?: number | null;
  note?: string | null;
  password?: string | null;
}

export interface SharedPasswordResponse {
  resource_type: "password_entry";
  entry_title: string;
  username: string | null;
  password: string;
  url: string | null;
  note: string | null;
  expires_at: string | null;
  view_count: number;
  max_views: number;
}

export interface SharedFileResponse {
  resource_type: "file";
  file_id: string;
  filename: string;
  size_bytes: number;
  content_type: string;
  note: string | null;
  expires_at: string | null;
  view_count: number;
  max_views: number;
}

export type SharedResource = SharedPasswordResponse | SharedFileResponse;

export interface UploadLinkInfo {
  valid: boolean;
  has_password: boolean;
  note: string | null;
  expires_at: string | null;
}

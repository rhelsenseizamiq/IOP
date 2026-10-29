import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { downloadBlob } from "../utils/downloadBlob";
import type { PaginatedResponse } from "../types/common";
import type { FileEntry, FileUpdate, FileUploadMeta } from "../types/file";
import type { ShareLink, ShareLinkCreate, UploadRequestCreate } from "../types/share";

// Large/slow transfers — same reasoning as the AI assistant's own 900s
// override in this codebase: a 250MB upload/download over this network
// needs real headroom beyond the default 30s apiClient timeout.
const TRANSFER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export const filesApi = {
  list: (
    params: { page?: number; page_size?: number; search?: string } = {},
  ): Promise<AxiosResponse<PaginatedResponse<FileEntry>>> =>
    apiClient.get("/files", { params }),

  get: (id: string): Promise<AxiosResponse<FileEntry>> =>
    apiClient.get(`/files/${id}`),

  upload: (
    file: File,
    meta: FileUploadMeta,
    onUploadProgress?: (percent: number) => void,
  ): Promise<AxiosResponse<FileEntry>> => {
    const form = new FormData();
    form.append("file", file);
    if (meta.description) form.append("description", meta.description);
    (meta.tags ?? []).forEach((t) => form.append("tags", t));
    if (meta.delete_after_first_download) {
      form.append("delete_after_first_download", "true");
    }
    form.append("expires_at", meta.expires_at);
    return apiClient.post("/files", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: TRANSFER_TIMEOUT_MS,
      onUploadProgress: onUploadProgress
        ? (evt) => {
            if (evt.total) onUploadProgress(Math.round((evt.loaded / evt.total) * 100));
          }
        : undefined,
    });
  },

  download: async (id: string, filename: string): Promise<void> => {
    const res = await apiClient.get(`/files/${id}/download`, {
      responseType: "blob",
      timeout: TRANSFER_TIMEOUT_MS,
    });
    downloadBlob(res.data as Blob, filename);
  },

  update: (id: string, data: FileUpdate): Promise<AxiosResponse<FileEntry>> =>
    apiClient.patch(`/files/${id}`, data),

  delete: (id: string): Promise<AxiosResponse<void>> =>
    apiClient.delete(`/files/${id}`),

  listShares: (id: string): Promise<AxiosResponse<ShareLink[]>> =>
    apiClient.get(`/files/${id}/shares`),

  createShare: (id: string, data: ShareLinkCreate): Promise<AxiosResponse<ShareLink>> =>
    apiClient.post(`/files/${id}/shares`, data),

  revokeShare: (shareId: string): Promise<AxiosResponse<void>> =>
    apiClient.delete(`/files/shares/${shareId}`),

  createUploadRequest: (data: UploadRequestCreate): Promise<AxiosResponse<ShareLink>> =>
    apiClient.post("/files/upload-requests", data),
};

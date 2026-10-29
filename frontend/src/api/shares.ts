// Public, fully anonymous share-resolution calls — deliberately raw axios,
// NOT the authenticated apiClient: there's no token for an anonymous
// recipient, and apiClient's 401-triggers-a-token-refresh interceptor
// would misfire on the "password_required" 401 this API uses for a
// password-protected link, which has nothing to do with an expired
// session. Same reasoning the original SharePage.tsx already used.
import axios from "axios";
import { downloadBlob } from "../utils/downloadBlob";
import type { SharedResource, UploadLinkInfo } from "../types/share";
import type { FileEntry } from "../types/file";

const BASE = "/api/v1";

export const publicSharesApi = {
  view: (token: string): Promise<SharedResource> =>
    axios.get<SharedResource>(`${BASE}/share/${token}`).then((r) => r.data),

  viewUploadInfo: (token: string): Promise<UploadLinkInfo> =>
    axios.get<UploadLinkInfo>(`${BASE}/share/${token}/upload-info`).then((r) => r.data),

  unlock: (token: string, password: string): Promise<SharedResource> =>
    axios
      .post<SharedResource>(`${BASE}/share/${token}/unlock`, { password })
      .then((r) => r.data),

  downloadFile: async (
    token: string,
    filename: string,
    password?: string,
  ): Promise<void> => {
    const form = new FormData();
    if (password) form.append("password", password);
    const res = await axios.post(`${BASE}/share/${token}/download`, form, {
      responseType: "blob",
      timeout: 10 * 60 * 1000,
    });
    downloadBlob(res.data as Blob, filename);
  },

  upload: (
    token: string,
    file: File,
    password?: string,
    onUploadProgress?: (percent: number) => void,
  ): Promise<FileEntry> => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    return axios
      .post<FileEntry>(`${BASE}/share/${token}/upload`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 10 * 60 * 1000,
        onUploadProgress: onUploadProgress
          ? (evt) => {
              if (evt.total) onUploadProgress(Math.round((evt.loaded / evt.total) * 100));
            }
          : undefined,
      })
      .then((r) => r.data);
  },
};

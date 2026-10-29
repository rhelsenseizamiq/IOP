import type { AxiosResponse } from 'axios';
import apiClient from './client';
import type {
  Cabinet,
  CabinetCreate,
  CabinetUpdate,
  Folder,
  FolderCreate,
  FolderUpdate,
  PasswordEntry,
  PasswordEntryCreate,
  PasswordEntryDetail,
  PasswordEntryUpdate,
} from '../types/vault';
import type { ShareLink, ShareLinkCreate } from '../types/share';

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export const cabinetsApi = {
  list: (): Promise<AxiosResponse<Cabinet[]>> =>
    apiClient.get('/cabinets'),
  get: (id: string): Promise<AxiosResponse<Cabinet>> =>
    apiClient.get(`/cabinets/${id}`),
  create: (data: CabinetCreate): Promise<AxiosResponse<Cabinet>> =>
    apiClient.post('/cabinets', data),
  update: (id: string, data: CabinetUpdate): Promise<AxiosResponse<Cabinet>> =>
    apiClient.patch(`/cabinets/${id}`, data),
  delete: (id: string): Promise<AxiosResponse<void>> =>
    apiClient.delete(`/cabinets/${id}`),
  addMembers: (id: string, usernames: string[]): Promise<AxiosResponse<Cabinet>> =>
    apiClient.post(`/cabinets/${id}/members`, { usernames }),
  removeMember: (id: string, username: string): Promise<AxiosResponse<Cabinet>> =>
    apiClient.delete(`/cabinets/${id}/members/${username}`),
};

export const foldersApi = {
  list: (cabinetId: string): Promise<AxiosResponse<Folder[]>> =>
    apiClient.get('/folders', { params: { cabinet_id: cabinetId } }),
  create: (data: FolderCreate): Promise<AxiosResponse<Folder>> =>
    apiClient.post('/folders', data),
  update: (id: string, data: FolderUpdate): Promise<AxiosResponse<Folder>> =>
    apiClient.patch(`/folders/${id}`, data),
  delete: (id: string): Promise<AxiosResponse<void>> =>
    apiClient.delete(`/folders/${id}`),
};

export const passwordsApi = {
  list: (
    cabinetId: string,
    page = 1,
    pageSize = 50,
    folderId?: string | null,
  ): Promise<AxiosResponse<PaginatedResponse<PasswordEntry>>> =>
    apiClient.get('/passwords', {
      params: {
        cabinet_id: cabinetId,
        page,
        page_size: pageSize,
        ...(folderId !== undefined && folderId !== null ? { folder_id: folderId } : {}),
      },
    }),
  get: (id: string): Promise<AxiosResponse<PasswordEntryDetail>> =>
    apiClient.get(`/passwords/${id}`),
  reveal: (id: string): Promise<AxiosResponse<{ password: string }>> =>
    apiClient.get(`/passwords/${id}/reveal`),
  create: (data: PasswordEntryCreate): Promise<AxiosResponse<PasswordEntry>> =>
    apiClient.post('/passwords', data),
  update: (id: string, data: PasswordEntryUpdate): Promise<AxiosResponse<PasswordEntry>> =>
    apiClient.patch(`/passwords/${id}`, data),
  move: (id: string, folderId: string | null): Promise<AxiosResponse<PasswordEntry>> =>
    apiClient.patch(`/passwords/${id}/move`, { folder_id: folderId }),
  delete: (id: string): Promise<AxiosResponse<void>> =>
    apiClient.delete(`/passwords/${id}`),
};

// Promoted from ShareModal.tsx's direct apiClient calls into a proper typed
// module, matching every other resource's convention (was the one
// exception — see FILE_SHARING_PLAN.md §4). Same paths, same payload
// shape, no behavior change.
export const sharesApi = {
  listForPassword: (entryId: string): Promise<AxiosResponse<ShareLink[]>> =>
    apiClient.get(`/passwords/${entryId}/shares`),
  createForPassword: (
    entryId: string,
    data: ShareLinkCreate,
  ): Promise<AxiosResponse<ShareLink>> =>
    apiClient.post(`/passwords/${entryId}/shares`, data),
  revokePasswordShare: (shareId: string): Promise<AxiosResponse<void>> =>
    apiClient.delete(`/passwords/shares/${shareId}`),
};

import apiClient from './client';
import type { AuditLog } from '../types/auditLog';
import type { IPRecord, IPRecordCreate, IPRecordUpdate, IPRecordFilters, OSType, Environment } from '../types/ipRecord';
import type { PaginatedResponse } from '../types/common';
import type { PingResult } from '../types/integrations';

export interface BulkUpdateFields {
  environment?: Environment;
  owner?: string;
  os_type?: OSType;
}

export interface ImportResult {
  imported: number;
  errors: { row: number; ip: string; error: string }[];
}

/** Trigger a CSV download from a Blob response */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const ipRecordsApi = {
  list: (filters: IPRecordFilters = {}) =>
    apiClient.get<PaginatedResponse<IPRecord>>('/ip-records', { params: filters }),

  get: (id: string) => apiClient.get<IPRecord>(`/ip-records/${id}`),

  getByIp: (ip: string) => apiClient.get<IPRecord>(`/ip-records/by-ip/${encodeURIComponent(ip)}`),

  create: (data: IPRecordCreate) => apiClient.post<IPRecord>('/ip-records', data),

  update: (id: string, data: IPRecordUpdate) =>
    apiClient.put<IPRecord>(`/ip-records/${id}`, data),

  delete: (id: string) => apiClient.delete<void>(`/ip-records/${id}`),

  reserve: (id: string) => apiClient.post<IPRecord>(`/ip-records/${id}/reserve`),

  release: (id: string) => apiClient.post<IPRecord>(`/ip-records/${id}/release`),

  downloadTemplate: async (): Promise<void> => {
    const res = await apiClient.get('/ip-records/export/template', { responseType: 'blob' });
    downloadBlob(res.data as Blob, 'ipam_import_template.csv');
  },

  exportRecords: async (filters: IPRecordFilters = {}): Promise<void> => {
    const res = await apiClient.get('/ip-records/export', {
      params: filters,
      responseType: 'blob',
    });
    downloadBlob(res.data as Blob, 'ipam_export.csv');
  },

  importRecords: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<ImportResult>('/ip-records/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  getHistory: (id: string) =>
    apiClient.get<AuditLog[]>(`/ip-records/${id}/history`),

  bulkReserve: (ids: string[]) =>
    apiClient.post<{ modified: number }>('/ip-records/bulk/reserve', { ids }),

  bulkRelease: (ids: string[]) =>
    apiClient.post<{ modified: number }>('/ip-records/bulk/release', { ids }),

  bulkUpdate: (ids: string[], fields: BulkUpdateFields) =>
    apiClient.post<{ modified: number }>('/ip-records/bulk/update', { ids, ...fields }),

  ping: (id: string, autoUpdate = true) =>
    apiClient.post<PingResult>(`/ip-records/${id}/ping`, { auto_update: autoUpdate }),
};

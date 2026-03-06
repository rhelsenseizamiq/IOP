import apiClient from './client';
import type { VRF, VRFCreate, VRFUpdate } from '../types/vrf';
import type { PaginatedResponse } from '../types/common';

export const vrfsApi = {
  list: (params: { page?: number; page_size?: number } = {}) =>
    apiClient.get<PaginatedResponse<VRF>>('/vrfs', { params }),

  get: (id: string) => apiClient.get<VRF>(`/vrfs/${id}`),

  create: (data: VRFCreate) => apiClient.post<VRF>('/vrfs', data),

  update: (id: string, data: VRFUpdate) => apiClient.put<VRF>(`/vrfs/${id}`, data),

  delete: (id: string) => apiClient.delete<void>(`/vrfs/${id}`),
};

import apiClient from './client';
import type { IPRange, IPRangeCreate, IPRangeUpdate } from '../types/ipRange';
import type { PaginatedResponse } from '../types/common';

export const ipRangesApi = {
  listBySubnet: (subnetId: string, params: { page?: number; page_size?: number } = {}) =>
    apiClient.get<PaginatedResponse<IPRange>>('/ip-ranges', {
      params: { subnet_id: subnetId, ...params },
    }),

  get: (id: string) => apiClient.get<IPRange>(`/ip-ranges/${id}`),

  create: (data: IPRangeCreate) => apiClient.post<IPRange>('/ip-ranges', data),

  update: (id: string, data: IPRangeUpdate) => apiClient.put<IPRange>(`/ip-ranges/${id}`, data),

  delete: (id: string) => apiClient.delete<void>(`/ip-ranges/${id}`),
};

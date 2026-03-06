import apiClient from './client';
import type { RIR, RIRCreate, RIRUpdate } from '../types/rir';
import type { PaginatedResponse } from '../types/common';

export const rirsApi = {
  list: (params: { page?: number; page_size?: number } = {}) =>
    apiClient.get<PaginatedResponse<RIR>>('/rirs', { params }),

  get: (id: string) => apiClient.get<RIR>(`/rirs/${id}`),

  create: (data: RIRCreate) => apiClient.post<RIR>('/rirs', data),

  update: (id: string, data: RIRUpdate) => apiClient.put<RIR>(`/rirs/${id}`, data),

  delete: (id: string) => apiClient.delete<void>(`/rirs/${id}`),
};

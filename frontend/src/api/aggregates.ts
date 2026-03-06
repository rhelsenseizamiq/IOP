import apiClient from './client';
import type { Aggregate, AggregateCreate, AggregateUpdate } from '../types/aggregate';
import type { PaginatedResponse } from '../types/common';

export interface AggregateListParams {
  page?: number;
  page_size?: number;
  rir_id?: string;
  search?: string;
}

export const aggregatesApi = {
  list: (params: AggregateListParams = {}) =>
    apiClient.get<PaginatedResponse<Aggregate>>('/aggregates', { params }),

  get: (id: string) => apiClient.get<Aggregate>(`/aggregates/${id}`),

  create: (data: AggregateCreate) => apiClient.post<Aggregate>('/aggregates', data),

  update: (id: string, data: AggregateUpdate) =>
    apiClient.put<Aggregate>(`/aggregates/${id}`, data),

  delete: (id: string) => apiClient.delete<void>(`/aggregates/${id}`),
};

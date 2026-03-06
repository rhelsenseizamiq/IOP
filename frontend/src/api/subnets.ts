import apiClient from './client';
import type { Subnet, SubnetDetail, SubnetCreate, SubnetUpdate, SubnetTreeNode } from '../types/subnet';
import type { PaginatedResponse } from '../types/common';

export interface SubnetListParams {
  page?: number;
  page_size?: number;
  search?: string;
  environment?: string;
}

export interface SubnetTreeParams {
  vrf_id?: string;
  environment?: string;
}

export const subnetsApi = {
  list: (params: SubnetListParams = {}) =>
    apiClient.get<PaginatedResponse<SubnetDetail>>('/subnets', { params }),

  tree: (params: SubnetTreeParams = {}) =>
    apiClient.get<SubnetTreeNode[]>('/subnets/tree', { params }),

  get: (id: string) => apiClient.get<SubnetDetail>(`/subnets/${id}`),

  create: (data: SubnetCreate) => apiClient.post<Subnet>('/subnets', data),

  update: (id: string, data: SubnetUpdate) => apiClient.put<Subnet>(`/subnets/${id}`, data),

  delete: (id: string) => apiClient.delete<void>(`/subnets/${id}`),
};

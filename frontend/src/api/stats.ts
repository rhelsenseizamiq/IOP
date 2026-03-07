import apiClient from './client';
import type { DashboardStats } from '../types/stats';

export const statsApi = {
  get: () => apiClient.get<DashboardStats>('/stats'),
};

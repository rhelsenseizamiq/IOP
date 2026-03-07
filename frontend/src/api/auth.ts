import apiClient from './client';
import type { TokenResponse } from '../types/auth';

interface MeResponse {
  username: string;
  role: string;
  full_name: string;
}

interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post<TokenResponse>('/auth/login', { username, password }),

  logout: () => apiClient.post<void>('/auth/logout'),

  me: () => apiClient.get<MeResponse>('/auth/me'),

  refresh: () => apiClient.post<TokenResponse>('/auth/refresh'),

  changePassword: (payload: ChangePasswordPayload) =>
    apiClient.post<void>('/auth/change-password', payload),

  config: () => apiClient.get<{ ldap_enabled: boolean }>('/auth/config'),
};

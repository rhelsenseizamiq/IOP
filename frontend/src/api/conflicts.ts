import apiClient from './client';
import type { ConflictReport } from '../types/conflicts';

export const conflictsApi = {
  scan: (subnetId: string) =>
    apiClient.post<ConflictReport>(`/subnets/${subnetId}/scan-conflicts`),
};

import apiClient from './client';
import type {
  VsphereDiscoverRequest,
  VsphereImportRequest,
  VsphereImportResult,
  VsphereVM,
} from '../types/integrations';

export const integrationsApi = {
  vsphereDiscover: (body: VsphereDiscoverRequest) =>
    apiClient.post<VsphereVM[]>('/integrations/vsphere/discover', body),

  vsphereImport: (body: VsphereImportRequest) =>
    apiClient.post<VsphereImportResult>('/integrations/vsphere/import', body),
};

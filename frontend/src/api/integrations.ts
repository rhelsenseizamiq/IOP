import apiClient from './client';
import type {
  Device42DiscoverRequest,
  Device42IP,
  Device42ImportIP,
  Device42ImportResult,
  PaloAltoDiscoverRequest,
  PaloAltoDiscoverResult,
  PaloAltoImportAddress,
  PaloAltoImportResult,
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

  device42Discover: (body: Device42DiscoverRequest) =>
    apiClient.post<Device42IP[]>('/integrations/device42/discover', body),

  device42Import: (ips: Device42ImportIP[]) =>
    apiClient.post<Device42ImportResult>('/integrations/device42/import', { ips }),

  paloaltoDiscover: (body: PaloAltoDiscoverRequest) =>
    apiClient.post<PaloAltoDiscoverResult>('/integrations/paloalto/discover', body),

  paloaltoImport: (addresses: PaloAltoImportAddress[]) =>
    apiClient.post<PaloAltoImportResult>('/integrations/paloalto/import', { addresses }),
};

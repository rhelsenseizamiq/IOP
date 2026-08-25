import apiClient from "./client";
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
  ZabbixDiscoverRequest,
  ZabbixHost,
  ZabbixImportIP,
  ZabbixImportResult,
} from "../types/integrations";

export const integrationsApi = {
  vsphereDiscover: (body: VsphereDiscoverRequest) =>
    apiClient.post<VsphereVM[]>("/integrations/vsphere/discover", body),

  vsphereImport: (body: VsphereImportRequest) =>
    apiClient.post<VsphereImportResult>("/integrations/vsphere/import", body),

  device42Discover: (body: Device42DiscoverRequest) =>
    apiClient.post<Device42IP[]>("/integrations/device42/discover", body, {
      timeout: 120000, // Device42 pagination can take ~10s/page; large fetches exceed the 30s default
    }),

  device42Import: (ips: Device42ImportIP[]) =>
    apiClient.post<Device42ImportResult>("/integrations/device42/import", {
      ips,
    }),

  paloaltoDiscover: (body: PaloAltoDiscoverRequest) =>
    apiClient.post<PaloAltoDiscoverResult>(
      "/integrations/paloalto/discover",
      body,
    ),

  paloaltoImport: (addresses: PaloAltoImportAddress[]) =>
    apiClient.post<PaloAltoImportResult>("/integrations/paloalto/import", {
      addresses,
    }),

  zabbixDiscover: (body: ZabbixDiscoverRequest = {}) =>
    apiClient.post<ZabbixHost[]>("/integrations/zabbix/discover", body, {
      timeout: 60000,
    }),

  zabbixImport: (ips: ZabbixImportIP[]) =>
    apiClient.post<ZabbixImportResult>("/integrations/zabbix/import", {
      ips,
    }),
};

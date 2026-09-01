import apiClient, { getAccessToken } from "./client";
import type {
  Device42DiscoverRequest,
  Device42IP,
  Device42ImportIP,
  Device42ImportResult,
  PaloAltoBulkSaveResult,
  PaloAltoCheckResult,
  PaloAltoDiscoverRequest,
  PaloAltoDiscoverResult,
  PaloAltoImportAddress,
  PaloAltoImportResult,
  PaloAltoSaveResult,
  PaloAltoScanSubnetResult,
  PaloAltoCheckLogEntry,
  PaloAltoTrafficLogResult,
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

  paloaltoCheckIp: (ipAddress: string) =>
    apiClient.post<PaloAltoCheckResult>("/integrations/paloalto/check-ip", {
      ip_address: ipAddress,
    }),

  paloaltoCheckSubnet: (body: { cidr?: string; ip_addresses?: string[] }) =>
    apiClient.post<PaloAltoCheckResult[]>(
      "/integrations/paloalto/check-subnet",
      body,
      { timeout: 60000 },
    ),

  paloaltoSaveToRecords: (ipAddress: string) =>
    apiClient.post<PaloAltoSaveResult>(
      "/integrations/paloalto/save-to-records",
      { ip_address: ipAddress },
    ),

  paloaltoSaveBulk: (ipAddresses: string[]) =>
    apiClient.post<PaloAltoBulkSaveResult>(
      "/integrations/paloalto/save-bulk",
      { ip_addresses: ipAddresses },
      { timeout: 60000 },
    ),

  paloaltoScanSubnet: (subnetId: string) =>
    apiClient.post<PaloAltoScanSubnetResult>(
      `/integrations/paloalto/scan-subnet/${subnetId}`,
      {},
      { timeout: 60000 },
    ),

  paloaltoCheckLogs: (params?: { ip_address?: string; limit?: number }) =>
    apiClient.get<PaloAltoCheckLogEntry[]>(
      "/integrations/paloalto/check-logs",
      { params },
    ),

  paloaltoTrafficLogs: (ipAddress: string, days = 30) =>
    apiClient.post<PaloAltoTrafficLogResult>(
      "/integrations/paloalto/traffic-logs",
      { ip_address: ipAddress, days },
      { timeout: 45000 },
    ),

  zabbixDiscover: (body: ZabbixDiscoverRequest = {}) =>
    apiClient.post<ZabbixHost[]>("/integrations/zabbix/discover", body, {
      timeout: 60000,
    }),

  zabbixImport: (ips: ZabbixImportIP[]) =>
    apiClient.post<ZabbixImportResult>("/integrations/zabbix/import", {
      ips,
    }),
};

// ── PaloAlto real-time streaming (Server-Sent Events) ───────────────────────
//
// axios can't consume a streaming response body in the browser, so this
// bypasses it with a plain fetch() + manual reader, attaching the same
// Bearer token axios's interceptor would have set. Used by the PaloAlto
// Check page so log lines appear as they're actually produced instead of
// all at once when the check finishes.

export interface PaloAltoStreamHandlers {
  onLog?: (ip: string, line: string) => void;
  onResult?: (result: PaloAltoCheckResult) => void;
  onError?: (message: string) => void;
}

export async function readSSE(
  url: string,
  body: unknown,
  onEvent: (eventType: string, data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = `Stream request failed (${res.status})`;
    try {
      const data = await res.json();
      detail = data.detail ?? detail;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventType = "message";
      let data = "";
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }

      if (data) onEvent(eventType, data);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export async function paloaltoCheckStream(
  body: { cidr?: string; ip_addresses?: string[] },
  handlers: PaloAltoStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await readSSE(
    "/api/v1/integrations/paloalto/check-stream",
    body,
    (eventType, data) => {
      try {
        const parsed = JSON.parse(data);
        if (eventType === "log" && handlers.onLog) {
          handlers.onLog(parsed.ip, parsed.line);
        } else if (eventType === "result" && handlers.onResult) {
          handlers.onResult(parsed as PaloAltoCheckResult);
        } else if (eventType === "error" && handlers.onError) {
          handlers.onError(parsed.message ?? "Unknown streaming error");
        }
      } catch {
        // malformed/partial event — skip rather than crash the stream
      }
    },
    signal,
  );
}

export interface PaloAltoScanSubnetStreamHandlers {
  onLog?: (ip: string, line: string) => void;
  onResult?: (result: PaloAltoCheckResult) => void;
  onSummary?: (summary: PaloAltoScanSubnetResult) => void;
  onError?: (message: string) => void;
}

export async function paloaltoScanSubnetStream(
  subnetId: string,
  handlers: PaloAltoScanSubnetStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await readSSE(
    `/api/v1/integrations/paloalto/scan-subnet-stream/${subnetId}`,
    {},
    (eventType, data) => {
      try {
        const parsed = JSON.parse(data);
        if (eventType === "log" && handlers.onLog) {
          handlers.onLog(parsed.ip, parsed.line);
        } else if (eventType === "result" && handlers.onResult) {
          handlers.onResult(parsed as PaloAltoCheckResult);
        } else if (eventType === "summary" && handlers.onSummary) {
          handlers.onSummary(parsed as PaloAltoScanSubnetResult);
        } else if (eventType === "error" && handlers.onError) {
          handlers.onError(parsed.message ?? "Unknown streaming error");
        }
      } catch {
        // malformed/partial event — skip rather than crash the stream
      }
    },
    signal,
  );
}

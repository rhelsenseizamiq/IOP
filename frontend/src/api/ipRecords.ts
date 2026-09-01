import apiClient from "./client";
import { readSSE } from "./integrations";
import type { AuditLog } from "../types/auditLog";
import type {
  IPRecord,
  IPRecordCreate,
  IPRecordUpdate,
  IPRecordFilters,
  OSType,
  Environment,
} from "../types/ipRecord";
import type { PaginatedResponse } from "../types/common";
import type { PingResult, ScanSource } from "../types/integrations";

export interface BulkUpdateFields {
  environment?: Environment;
  owner?: string;
  os_type?: OSType;
}

export interface ImportResult {
  imported: number;
  errors: { row: number; ip: string; error: string }[];
}

/** Trigger a CSV download from a Blob response */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const ipRecordsApi = {
  list: (filters: IPRecordFilters = {}) =>
    apiClient.get<PaginatedResponse<IPRecord>>("/ip-records", {
      params: filters,
    }),

  get: (id: string) => apiClient.get<IPRecord>(`/ip-records/${id}`),

  getByIp: (ip: string) =>
    apiClient.get<IPRecord>(`/ip-records/by-ip/${encodeURIComponent(ip)}`),

  create: (data: IPRecordCreate) =>
    apiClient.post<IPRecord>("/ip-records", data),

  update: (id: string, data: IPRecordUpdate) =>
    apiClient.put<IPRecord>(`/ip-records/${id}`, data),

  delete: (id: string) => apiClient.delete<void>(`/ip-records/${id}`),

  reserve: (id: string) =>
    apiClient.post<IPRecord>(`/ip-records/${id}/reserve`),

  release: (id: string) =>
    apiClient.post<IPRecord>(`/ip-records/${id}/release`),

  downloadTemplate: async (): Promise<void> => {
    const res = await apiClient.get("/ip-records/export/template", {
      responseType: "blob",
    });
    downloadBlob(res.data as Blob, "ipam_import_template.csv");
  },

  exportRecords: async (filters: IPRecordFilters = {}): Promise<void> => {
    const res = await apiClient.get("/ip-records/export", {
      params: filters,
      responseType: "blob",
    });
    downloadBlob(res.data as Blob, "ipam_export.csv");
  },

  importRecords: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.post<ImportResult>("/ip-records/import", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  getHistory: (id: string) =>
    apiClient.get<AuditLog[]>(`/ip-records/${id}/history`),

  bulkReserve: (ids: string[]) =>
    apiClient.post<{ modified: number }>("/ip-records/bulk/reserve", { ids }),

  bulkRelease: (ids: string[]) =>
    apiClient.post<{ modified: number }>("/ip-records/bulk/release", { ids }),

  bulkUpdate: (ids: string[], fields: BulkUpdateFields) =>
    apiClient.post<{ modified: number }>("/ip-records/bulk/update", {
      ids,
      ...fields,
    }),

  ping: (id: string, autoUpdate = true, scanSource?: ScanSource) =>
    apiClient.post<PingResult>(`/ip-records/${id}/ping`, {
      auto_update: autoUpdate,
      scan_source: scanSource ?? null,
    }),

  checkIp: (ipAddress: string, scanSource?: ScanSource) =>
    apiClient.post<PingResult>("/ip-records/check-ip", {
      ip_address: ipAddress,
      scan_source: scanSource ?? null,
    }),

  getDuplicates: () =>
    apiClient.get<DuplicatesResult>("/ip-records/duplicates"),
};

export interface DuplicateRecordRef {
  id: string;
  ip_address: string;
  hostname: string | null;
  status: string;
}

export interface DuplicateGroup {
  value: string;
  count: number;
  records: DuplicateRecordRef[];
}

export interface DuplicatesResult {
  duplicate_ips: DuplicateGroup[];
  duplicate_hostnames: DuplicateGroup[];
}

// ── Merged Check Availability (Device42 + Zabbix + PaloAlto, streamed) ──────
//
// Replaces the old per-source dropdown: one click scans all three in
// sequence, streaming progress for each ("checking" then "done"/"error")
// so the UI can show "scanning Device42… found", "scanning Zabbix… not
// found", "scanning PaloAlto… found" as it happens, then applies the
// combined result immediately.

export interface CheckAvailabilityProgressEvent {
  source: "device42" | "zabbix" | "paloalto";
  status: "checking" | "done" | "error";
  found?: boolean;
  name?: string | null;
  message?: string;
}

export interface CheckAvailabilityResult {
  ip_address: string;
  found: boolean;
  status_updated?: boolean;
  new_status?: string | null;
  hostname?: string | null;
  os_type?: string | null;
  device42_found: boolean;
  zabbix_found: boolean;
  paloalto_found: boolean;
}

export interface CheckAvailabilityHandlers {
  onProgress?: (event: CheckAvailabilityProgressEvent) => void;
  onResult?: (result: CheckAvailabilityResult) => void;
  onError?: (message: string) => void;
}

function handleCheckAvailabilityEvent(
  eventType: string,
  data: string,
  handlers: CheckAvailabilityHandlers,
): void {
  try {
    const parsed = JSON.parse(data);
    if (eventType === "progress" && handlers.onProgress) {
      handlers.onProgress(parsed as CheckAvailabilityProgressEvent);
    } else if (eventType === "result" && handlers.onResult) {
      handlers.onResult(parsed as CheckAvailabilityResult);
    } else if (eventType === "error" && handlers.onError) {
      handlers.onError(parsed.message ?? "Unknown streaming error");
    }
  } catch {
    // malformed/partial event — skip rather than crash the stream
  }
}

/** For an existing IP record — scans all 3 sources and updates its status/hostname immediately. */
export async function checkAvailabilityStream(
  id: string,
  handlers: CheckAvailabilityHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await readSSE(
    `/api/v1/ip-records/${id}/check-availability-stream`,
    {},
    (eventType, data) =>
      handleCheckAvailabilityEvent(eventType, data, handlers),
    signal,
  );
}

/** For an address with no IP record yet (Unused IPs page) — informational only. */
export async function checkAvailabilityStreamByIp(
  ipAddress: string,
  handlers: CheckAvailabilityHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await readSSE(
    "/api/v1/ip-records/check-availability-stream",
    { ip_address: ipAddress },
    (eventType, data) =>
      handleCheckAvailabilityEvent(eventType, data, handlers),
    signal,
  );
}

// ── Bulk Check Availability — sequential Device42+Zabbix+PaloAlto scan over
// a list of existing record IDs. Powers "Bulk Scan" from the Duplicates and
// Stale In-Use Records panels. Reuses the same per-record progress/result
// events as the single-record scan above, wrapped in record-start /
// record-error markers plus a final batch summary.

export interface BulkScanRecordStart {
  index: number;
  total: number;
  id: string;
  ip_address: string;
}

export interface BulkScanRecordError {
  index: number;
  total: number;
  id: string;
  message: string;
}

export interface BulkScanSummary {
  total: number;
  scanned: number;
  found: number;
  updated: number;
  errors: string[];
}

export interface BulkCheckAvailabilityHandlers {
  onRecordStart?: (event: BulkScanRecordStart) => void;
  onProgress?: (event: CheckAvailabilityProgressEvent) => void;
  onRecordResult?: (result: CheckAvailabilityResult) => void;
  onRecordError?: (event: BulkScanRecordError) => void;
  onSummary?: (summary: BulkScanSummary) => void;
  onError?: (message: string) => void;
}

export async function bulkCheckAvailabilityStream(
  ids: string[],
  handlers: BulkCheckAvailabilityHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await readSSE(
    "/api/v1/ip-records/bulk/check-availability-stream",
    { ids },
    (eventType, data) => {
      try {
        const parsed = JSON.parse(data);
        if (eventType === "record-start" && handlers.onRecordStart) {
          handlers.onRecordStart(parsed as BulkScanRecordStart);
        } else if (eventType === "progress" && handlers.onProgress) {
          handlers.onProgress(parsed as CheckAvailabilityProgressEvent);
        } else if (eventType === "result" && handlers.onRecordResult) {
          handlers.onRecordResult(parsed as CheckAvailabilityResult);
        } else if (eventType === "record-error" && handlers.onRecordError) {
          handlers.onRecordError(parsed as BulkScanRecordError);
        } else if (eventType === "summary" && handlers.onSummary) {
          handlers.onSummary(parsed as BulkScanSummary);
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

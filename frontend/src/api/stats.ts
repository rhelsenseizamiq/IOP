import apiClient from "./client";
import type { AnomalyDigest, DashboardStats, SystemHealth } from "../types/stats";

export const statsApi = {
  get: () => apiClient.get<DashboardStats>("/stats"),
  // Pre-computed nightly (scripts/anomaly_digest.py) — never generated
  // on-demand, so this is always a fast plain read.
  getAnomalyDigest: () => apiClient.get<AnomalyDigest>("/stats/anomaly-digest"),
  // No DB query behind this one at all — /proc + a host-written JSON
  // snapshot file, see app/services/system_health.py. Safe to poll.
  getSystemHealth: () => apiClient.get<SystemHealth>("/stats/system-health"),
};

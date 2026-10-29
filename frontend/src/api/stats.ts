import apiClient from "./client";
import type { AnomalyDigest, DashboardStats } from "../types/stats";

export const statsApi = {
  get: () => apiClient.get<DashboardStats>("/stats"),
  // Pre-computed nightly (scripts/anomaly_digest.py) — never generated
  // on-demand, so this is always a fast plain read.
  getAnomalyDigest: () => apiClient.get<AnomalyDigest>("/stats/anomaly-digest"),
};

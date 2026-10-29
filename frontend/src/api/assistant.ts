import apiClient from "./client";

export interface AssistantSourceItem {
  text: string;
  score: number;
  source_collection: string;
  source_id: string;
  metadata: Record<string, unknown>;
}

export interface AskResponse {
  answer: string;
  sources: AssistantSourceItem[];
}

export interface SearchResponse {
  results: AssistantSourceItem[];
}

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
  sources: AssistantSourceItem[] | null;
  created_at: string;
}

export interface HistoryResponse {
  session_id: string;
  messages: HistoryMessage[];
}

export interface SessionSummary {
  session_id: string;
  preview: string;
  last_message_at: string;
  message_count: number;
  is_current: boolean;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
}

// Overrides apiClient's default 30s timeout — this offline assistant runs
// on CPU hardware with no AVX2 (~1.1 tok/s prompt eval, ~0.18 tok/s
// generation measured), so both calls are genuinely slow, not hung.
// Must match nginx's proxy_read_timeout and ai_service.py's
// _CHAT_READ_TIMEOUT — kept in sync manually, there's no shared config.
const ASK_TIMEOUT_MS = 900_000;
const SEARCH_TIMEOUT_MS = 60_000;

export const assistantApi = {
  ask: (question: string) =>
    apiClient.post<AskResponse>(
      "/assistant/ask",
      { question },
      { timeout: ASK_TIMEOUT_MS },
    ),
  search: (query: string, top_k = 8) =>
    apiClient.post<SearchResponse>(
      "/assistant/search",
      { query, top_k },
      { timeout: SEARCH_TIMEOUT_MS },
    ),
  history: () => apiClient.get<HistoryResponse>("/assistant/history"),
  // Ends the current conversation and starts a new one — does NOT delete
  // anything server-side; prior messages stay saved under the old
  // session, they just stop showing up in /history afterward.
  newSession: () => apiClient.post<void>("/assistant/session/new"),
  sessions: () => apiClient.get<SessionListResponse>("/assistant/sessions"),
  switchSession: (session_id: string) =>
    apiClient.post<HistoryResponse>("/assistant/session/switch", {
      session_id,
    }),
  // Permanently deletes a conversation — the one explicit exception to
  // "history is never deleted automatically".
  deleteSession: (session_id: string) =>
    apiClient.delete<void>(
      `/assistant/session/${encodeURIComponent(session_id)}`,
    ),
};

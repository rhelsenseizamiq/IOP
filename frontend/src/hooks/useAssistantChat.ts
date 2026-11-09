import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { assistantApi, type AssistantSourceItem } from "../api/assistant";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  sources?: AssistantSourceItem[];
  error?: boolean;
}

/**
 * The AI Assistant's core chat state/logic (ask a question, load this
 * user's current conversation, start a fresh one, navigate to a cited
 * source) — shared between the full /assistant page and the compact
 * floating-cat popup, so both ever talk to the backend the same way
 * instead of two slightly different chat implementations.
 *
 * Deliberately does NOT include conversation-history browsing (listing
 * past sessions, switching, deleting) — that stays AssistantPage-only;
 * the popup is "continue the current conversation", not a full inbox.
 */
export function useAssistantChat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [startingNew, setStartingNew] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    assistantApi
      .history()
      .then((res) => {
        setMessages(
          res.data.messages.map((m) => ({
            role: m.role,
            text: m.text,
            sources: m.sources ?? undefined,
          })),
        );
      })
      .catch(() => {
        /* non-critical — an empty conversation is a safe fallback */
      })
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) return;
    setElapsedSec(0);
    const interval = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [loading]);

  const openSource = (item: AssistantSourceItem): void => {
    if (
      (item.source_collection === "ip_records" ||
        item.source_collection === "live_check") &&
      item.metadata.ip_address
    ) {
      navigate(
        `/ip-records?search=${encodeURIComponent(String(item.metadata.ip_address))}`,
      );
    } else if (item.source_collection === "subnets" && item.metadata.cidr) {
      navigate(
        `/subnets?search=${encodeURIComponent(String(item.metadata.cidr))}`,
      );
    }
  };

  const sourceChipLabel = (item: AssistantSourceItem): string => {
    if (item.source_collection === "live_check" && item.metadata.source) {
      return String(item.metadata.source);
    }
    return String(
      item.metadata.ip_address ?? item.metadata.cidr ?? item.source_id,
    );
  };

  const send = useCallback(async (): Promise<void> => {
    const question = input.trim();
    if (!question || loading || historyLoading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setLoading(true);
    try {
      const res = await assistantApi.ask(question);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: res.data.answer, sources: res.data.sources },
      ]);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            axiosErr.response?.data?.detail ??
            "The assistant is unavailable right now.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, historyLoading]);

  const startNewConversation = useCallback(async (): Promise<boolean> => {
    setStartingNew(true);
    try {
      await assistantApi.newSession();
      setMessages([]);
      return true;
    } catch {
      return false;
    } finally {
      setStartingNew(false);
    }
  }, []);

  return {
    messages,
    setMessages,
    input,
    setInput,
    loading,
    historyLoading,
    startingNew,
    elapsedSec,
    bottomRef,
    send,
    startNewConversation,
    openSource,
    sourceChipLabel,
  };
}

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Typography,
  Input,
  Button,
  Card,
  Space,
  Tag,
  Spin,
  Alert,
  Popconfirm,
  message,
  List,
} from "antd";
import {
  RobotOutlined,
  SendOutlined,
  UserOutlined,
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  assistantApi,
  type AssistantSourceItem,
  type SessionSummary,
} from "../../api/assistant";

dayjs.extend(relativeTime);

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  sources?: AssistantSourceItem[];
  error?: boolean;
}

const ACCENT = "#63e2b7";

const AssistantPage: React.FC = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [startingNew, setStartingNew] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(
    null,
  );
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(() => {
    assistantApi
      .sessions()
      .then((res) => setSessions(res.data.sessions))
      .catch(() => {
        /* non-critical — the sidebar just stays empty */
      });
  }, []);

  // Loads this user's own current conversation on every mount — the
  // backend is the source of truth, so navigating away and back (or
  // refreshing the page) picks the conversation back up instead of
  // starting empty. Scoped server-side to the logged-in user's own
  // token; no user can load another's history or sessions this way.
  useEffect(() => {
    assistantApi
      .history()
      .then((res) => {
        setCurrentSessionId(res.data.session_id);
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
    refreshSessions();
  }, [refreshSessions]);

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

  // A live-IP-check result has one source PER checked source (Device42,
  // Zabbix, PaloAlto, vSphere) — all sharing the same ip_address, so
  // falling back to metadata.ip_address for the chip label would show
  // the same IP repeated 2-4 times (a real reported bug). Show which
  // source it came from instead.
  const sourceChipLabel = (item: AssistantSourceItem): string => {
    if (item.source_collection === "live_check" && item.metadata.source) {
      return String(item.metadata.source);
    }
    return String(
      item.metadata.ip_address ?? item.metadata.cidr ?? item.source_id,
    );
  };

  const send = async (): Promise<void> => {
    const question = input.trim();
    // historyLoading guard avoids a race: if history resolves after a
    // message was already sent, its setMessages(...) would overwrite
    // the just-added optimistic message instead of merging with it.
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
      refreshSessions(); // updates this conversation's preview/timestamp in the sidebar
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
  };

  const startNewConversation = async (): Promise<void> => {
    setStartingNew(true);
    try {
      await assistantApi.newSession();
      setMessages([]);
      setCurrentSessionId(null);
      refreshSessions();
    } catch {
      message.error("Couldn't start a new conversation. Try again shortly.");
    } finally {
      setStartingNew(false);
    }
  };

  const switchToSession = async (sessionId: string): Promise<void> => {
    if (sessionId === currentSessionId || loading) return;
    setSwitchingSessionId(sessionId);
    try {
      const res = await assistantApi.switchSession(sessionId);
      setCurrentSessionId(res.data.session_id);
      setMessages(
        res.data.messages.map((m) => ({
          role: m.role,
          text: m.text,
          sources: m.sources ?? undefined,
        })),
      );
      setSessions((prev) =>
        prev.map((s) => ({ ...s, is_current: s.session_id === sessionId })),
      );
    } catch {
      message.error("Couldn't open that conversation. Try again shortly.");
    } finally {
      setSwitchingSessionId(null);
    }
  };

  const deleteConversation = async (sessionId: string): Promise<void> => {
    setDeletingSessionId(sessionId);
    try {
      await assistantApi.deleteSession(sessionId);
      if (sessionId === currentSessionId) {
        // The backend auto-starts a fresh session when the current one
        // is deleted — re-fetch to pick up its real session_id rather
        // than guessing it locally.
        const res = await assistantApi.history();
        setCurrentSessionId(res.data.session_id);
        setMessages(
          res.data.messages.map((m) => ({
            role: m.role,
            text: m.text,
            sources: m.sources ?? undefined,
          })),
        );
      }
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
    } catch {
      message.error("Couldn't delete that conversation. Try again shortly.");
    } finally {
      setDeletingSessionId(null);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        height: "calc(100vh - 112px)",
      }}
    >
      <div
        style={{
          width: 240,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          paddingRight: 12,
        }}
      >
        <Typography.Text
          strong
          style={{ marginBottom: 8, fontSize: 12, letterSpacing: 0.5 }}
        >
          CONVERSATIONS
        </Typography.Text>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {sessions.length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Your past conversations will appear here.
            </Typography.Text>
          )}
          <List
            dataSource={sessions}
            size="small"
            rowKey="session_id"
            renderItem={(s) => (
              <List.Item
                onClick={() => switchToSession(s.session_id)}
                style={{
                  cursor: "pointer",
                  padding: "8px 6px 8px 10px",
                  borderRadius: 6,
                  border: "none",
                  marginBottom: 4,
                  background: s.is_current ? `${ACCENT}1a` : undefined,
                  borderLeft: s.is_current
                    ? `3px solid ${ACCENT}`
                    : "3px solid transparent",
                  opacity:
                    switchingSessionId === s.session_id ||
                    deletingSessionId === s.session_id
                      ? 0.5
                      : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    width: "100%",
                    gap: 4,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        color: s.is_current ? ACCENT : undefined,
                      }}
                    >
                      <MessageOutlined
                        style={{ fontSize: 11, flexShrink: 0 }}
                      />
                      <Typography.Text
                        ellipsis
                        style={{
                          fontSize: 13,
                          color: s.is_current ? ACCENT : undefined,
                        }}
                      >
                        {s.preview}
                      </Typography.Text>
                    </div>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 11, paddingLeft: 17 }}
                    >
                      {dayjs(s.last_message_at).fromNow()}
                    </Typography.Text>
                  </div>
                  <Popconfirm
                    title="Delete this conversation?"
                    description="This permanently deletes it — it can't be undone."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      deleteConversation(s.session_id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flexShrink: 0, color: "rgba(255,255,255,0.45)" }}
                    />
                  </Popconfirm>
                </div>
              </List.Item>
            )}
          />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              <RobotOutlined style={{ marginRight: 8, color: ACCENT }} />
              AI Assistant
            </Typography.Title>
            <Typography.Text type="secondary">
              Ask questions about subnet inventory — answered from this IPAM's
              own data, entirely offline (no data leaves this server). Runs on
              older hardware, so answers can take several minutes — that's
              expected, not a hang.
            </Typography.Text>
          </div>
          <Popconfirm
            title="Start a new conversation?"
            description="Your current conversation is saved and never deleted — this just starts a fresh one."
            onConfirm={startNewConversation}
            okText="Start new"
            disabled={historyLoading || messages.length === 0}
          >
            <Button
              icon={<PlusOutlined />}
              loading={startingNew}
              disabled={historyLoading || messages.length === 0}
            >
              New Conversation
            </Button>
          </Popconfirm>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 4px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {historyLoading && (
            <div
              style={{ display: "flex", justifyContent: "center", padding: 24 }}
            >
              <Spin />
            </div>
          )}

          {!historyLoading && messages.length === 0 && (
            <Alert
              type="info"
              showIcon
              message="Try asking things like:"
              description={
                <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                  <li>Which subnets are close to full?</li>
                  <li>What's the gateway for 10.128.41.0/24?</li>
                  <li>Is 10.1.2.3 in use in PaloAlto?</li>
                  <li>What's the server's RAM/CPU usage right now?</li>
                </ul>
              }
            />
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background:
                    msg.role === "user"
                      ? "rgba(255,255,255,0.08)"
                      : `${ACCENT}22`,
                  color:
                    msg.role === "user" ? "rgba(255,255,255,0.65)" : ACCENT,
                }}
              >
                {msg.role === "user" ? <UserOutlined /> : <RobotOutlined />}
              </div>
              <Card
                size="small"
                style={{
                  flex: 1,
                  maxWidth: 720,
                  borderColor: msg.error ? "#e57373" : undefined,
                }}
              >
                <Typography.Paragraph
                  style={{ margin: 0, whiteSpace: "pre-wrap" }}
                >
                  {msg.text}
                </Typography.Paragraph>
                {msg.sources && msg.sources.length > 0 && (
                  <Space wrap style={{ marginTop: 10 }}>
                    {msg.sources.map((s, j) => (
                      <Tag
                        key={j}
                        color={ACCENT}
                        style={{ cursor: "pointer" }}
                        onClick={() => openSource(s)}
                      >
                        {sourceChipLabel(s)}
                      </Tag>
                    ))}
                  </Space>
                )}
              </Card>
            </div>
          ))}

          {loading && (
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                paddingLeft: 40,
              }}
            >
              <Spin size="small" />
              <Typography.Text type="secondary">
                Thinking… ({elapsedSec}s — this runs on older CPU hardware and
                can take several minutes)
              </Typography.Text>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about subnets…"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={loading || historyLoading}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={send}
            loading={loading}
            disabled={!input.trim() || historyLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default AssistantPage;

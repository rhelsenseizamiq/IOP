import React, { useState, useEffect, useCallback } from "react";
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
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { assistantApi, type SessionSummary } from "../../api/assistant";
import { useAssistantChat } from "../../hooks/useAssistantChat";

dayjs.extend(relativeTime);

const ACCENT = "#63e2b7";

const AssistantPage: React.FC = () => {
  const {
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
    startNewConversation: startNewConversationBase,
    openSource,
    sourceChipLabel,
  } = useAssistantChat();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(
    null,
  );
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null,
  );

  const refreshSessions = useCallback(() => {
    assistantApi
      .sessions()
      .then((res) => setSessions(res.data.sessions))
      .catch(() => {
        /* non-critical — the sidebar just stays empty */
      });
  }, []);

  // The hook already loads this user's current conversation into
  // `messages` on mount — this just also captures the session_id for
  // the sidebar's "which conversation is open" highlight, and loads the
  // sessions list itself (the hook doesn't need either for the popup).
  useEffect(() => {
    assistantApi
      .history()
      .then((res) => setCurrentSessionId(res.data.session_id))
      .catch(() => {
        /* non-critical */
      });
    refreshSessions();
  }, [refreshSessions]);

  const startNewConversation = async (): Promise<void> => {
    const ok = await startNewConversationBase();
    if (ok) {
      setCurrentSessionId(null);
      refreshSessions();
    } else {
      message.error("Couldn't start a new conversation. Try again shortly.");
    }
  };

  // Wraps the hook's send() to also refresh the sidebar's conversation
  // preview/timestamp — something only this page's sidebar needs, so it
  // isn't part of the shared hook itself.
  const sendAndRefresh = async (): Promise<void> => {
    await send();
    refreshSessions();
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
                sendAndRefresh();
              }
            }}
            placeholder="Ask about subnets…"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={loading || historyLoading}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={sendAndRefresh}
            loading={loading}
            disabled={!input.trim() || historyLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default AssistantPage;

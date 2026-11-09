import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Tooltip,
  Typography,
  Input,
  Button,
  Card,
  Space,
  Tag,
  Spin,
} from "antd";
import {
  CloseOutlined,
  SendOutlined,
  UserOutlined,
  RobotOutlined,
  ExpandOutlined,
} from "@ant-design/icons";
import UseAnimations from "react-useanimations";
import cpuAnimation from "react-useanimations/lib/cpu";
import { useAuth } from "../../context/AuthContext";
import { useAssistantChat } from "../../hooks/useAssistantChat";

const BRAND_COLOR = "#63e2b7";

/**
 * A small floating button, bottom-right on every page — opens a compact
 * IOP AI Assistant chat popup right there (same window, nothing to
 * navigate away from), sharing its chat logic with the full /assistant
 * page via useAssistantChat() rather than a second implementation.
 * Conversation-history browsing (past sessions list, switch, delete)
 * stays page-only — the popup is "continue the current conversation",
 * with a one-click link to the full page for anything more than that.
 * Only shown once logged in, and hidden on the Assistant page itself.
 *
 * Was originally a hand-drawn cat mascot — replaced with the same
 * animated CPU icon used in the Assistant's other headers (sidebar,
 * full page, this popup's own header) for one consistent icon across
 * the feature instead of a cat everywhere else and a CPU here.
 */
const FloatingAssistantWidget: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const {
    messages,
    input,
    setInput,
    loading,
    historyLoading,
    elapsedSec,
    bottomRef,
    send,
    openSource,
    sourceChipLabel,
  } = useAssistantChat();

  if (!isAuthenticated || location.pathname === "/assistant") return null;

  return (
    <>
      <style>{`
        @keyframes assistantWidgetBob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .assistant-widget-badge { animation: assistantWidgetBob 3s ease-in-out infinite; }
        .assistant-widget-badge:hover { animation-play-state: paused; }
      `}</style>

      {open && (
        <div
          style={{
            position: "fixed",
            right: 24,
            bottom: 92,
            width: 360,
            height: 480,
            background: "#1e1e28",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 14,
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: "#16161f",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              flexShrink: 0,
            }}
          >
            <Typography.Text strong style={{ color: BRAND_COLOR }}>
              <span style={{ marginRight: 8, verticalAlign: "middle", display: "inline-block" }}>
                <UseAnimations
                  animation={cpuAnimation}
                  interaction="hover-replay"
                  size={18}
                  strokeColor={BRAND_COLOR}
                />
              </span>
              IOP AI Assistant
            </Typography.Text>
            <Space size={4}>
              <Tooltip title="Open full page">
                <Button
                  type="text"
                  size="small"
                  icon={<ExpandOutlined />}
                  onClick={() => {
                    setOpen(false);
                    navigate("/assistant");
                  }}
                />
              </Tooltip>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={() => setOpen(false)}
              />
            </Space>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {historyLoading && (
              <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
                <Spin size="small" />
              </div>
            )}

            {!historyLoading && messages.length === 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Ask about subnet inventory — answered from this IPAM's own
                data. Runs on older hardware, so answers can take a few
                minutes.
              </Typography.Text>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    marginTop: 2,
                    background: msg.role === "user" ? "rgba(255,255,255,0.08)" : `${BRAND_COLOR}22`,
                    color: msg.role === "user" ? "rgba(255,255,255,0.65)" : BRAND_COLOR,
                  }}
                >
                  {msg.role === "user" ? <UserOutlined /> : <RobotOutlined />}
                </div>
                <Card
                  size="small"
                  style={{
                    flex: 1,
                    borderColor: msg.error ? "#e57373" : undefined,
                  }}
                  styles={{ body: { padding: "6px 10px" } }}
                >
                  <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12.5 }}>
                    {msg.text}
                  </Typography.Paragraph>
                  {msg.sources && msg.sources.length > 0 && (
                    <Space wrap size={4} style={{ marginTop: 6 }}>
                      {msg.sources.map((s, j) => (
                        <Tag
                          key={j}
                          color={BRAND_COLOR}
                          style={{ cursor: "pointer", fontSize: 11 }}
                          onClick={() => {
                            setOpen(false);
                            openSource(s);
                          }}
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
              <div style={{ display: "flex", gap: 8, alignItems: "center", paddingLeft: 30 }}>
                <Spin size="small" />
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  Thinking… ({elapsedSec}s)
                </Typography.Text>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div
            style={{
              display: "flex",
              gap: 6,
              padding: 10,
              borderTop: "1px solid rgba(255,255,255,0.07)",
              flexShrink: 0,
            }}
          >
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
              autoSize={{ minRows: 1, maxRows: 3 }}
              disabled={loading || historyLoading}
              size="small"
            />
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              onClick={send}
              loading={loading}
              disabled={!input.trim() || historyLoading}
            />
          </div>
        </div>
      )}

      <Tooltip title={open ? "" : "Ask IOP AI Assistant"} placement="left">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Open IOP AI Assistant"
          className="assistant-widget-badge"
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "#252530",
            border: `1.5px solid ${BRAND_COLOR}66`,
            boxShadow: `0 4px 16px rgba(0,0,0,0.4), 0 0 0 4px ${BRAND_COLOR}11`,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 0,
          }}
        >
          {open ? (
            <CloseOutlined style={{ fontSize: 20, color: BRAND_COLOR }} />
          ) : (
            <UseAnimations
              animation={cpuAnimation}
              interaction="hover-replay"
              size={30}
              strokeColor={BRAND_COLOR}
            />
          )}
        </button>
      </Tooltip>
    </>
  );
};

export default FloatingAssistantWidget;

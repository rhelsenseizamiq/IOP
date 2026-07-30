import React, { useEffect, useState, useCallback } from "react";
import {
  Card,
  Typography,
  Descriptions,
  Button,
  Space,
  Spin,
  Result,
  message,
  Tooltip,
} from "antd";
import {
  EyeOutlined,
  EyeInvisibleOutlined,
  CopyOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useParams } from "react-router-dom";
import axios from "axios";

const { Title, Text } = Typography;

interface SharedEntry {
  entry_title: string;
  username: string | null;
  password: string;
  url: string | null;
  note: string | null;
  expires_at: string;
  view_count: number;
  max_views: number;
}

const BASE = "/api/v1";

const SharePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [entry, setEntry] = useState<SharedEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    axios
      .get<SharedEntry>(`${BASE}/share/${token}`)
      .then((r) => setEntry(r.data))
      .catch((err) => {
        if (err.response?.status === 404)
          setError("This share link was not found.");
        else if (err.response?.status === 410)
          setError(
            err.response?.data?.detail ??
              "This share link has expired or been revoked.",
          );
        else if (err.response?.status === 429)
          setError("Too many requests. Please wait a moment and try again.");
        else setError("Failed to load shared entry. The link may be invalid.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Auto-hide after 30 seconds when revealed
  useEffect(() => {
    if (!revealed) {
      setCountdown(null);
      return;
    }
    setCountdown(30);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c === null || c <= 1) {
          clearInterval(interval);
          setRevealed(false);
          return null;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [revealed]);

  const copyText = useCallback((text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => message.success(`${label} copied`));
  }, []);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Result
          status="404"
          title="Link Unavailable"
          subTitle={error ?? "Invalid share link."}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f1b2d 0%, #1a2942 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Card
        style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
        styles={{ header: { borderBottom: "1px solid #f0f0f0" } }}
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: "#52c41a" }} />
            <span>Shared Credential</span>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <div>
            <Title level={4} style={{ marginBottom: 4 }}>
              {entry.entry_title}
            </Title>
            {entry.note && (
              <Text type="secondary" style={{ fontStyle: "italic" }}>
                {entry.note}
              </Text>
            )}
          </div>

          <Descriptions column={1} size="small" bordered>
            {entry.username && (
              <Descriptions.Item
                label="Username"
                contentStyle={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text copyable={{ tooltips: ["Copy", "Copied!"] }}>
                  {entry.username}
                </Text>
              </Descriptions.Item>
            )}

            <Descriptions.Item label="Password">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontFamily: "monospace",
                    fontSize: 15,
                    letterSpacing: revealed ? 1 : 3,
                    filter: revealed ? "none" : "blur(6px)",
                    userSelect: revealed ? "auto" : "none",
                    transition: "filter 0.2s",
                    whiteSpace: "pre",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {entry.password}
                </Text>
                <Space size={4}>
                  <Tooltip
                    title={
                      revealed
                        ? `Hide (auto-hides in ${countdown}s)`
                        : "Show password"
                    }
                  >
                    <Button
                      type={revealed ? "primary" : "default"}
                      size="small"
                      icon={
                        revealed ? <EyeInvisibleOutlined /> : <EyeOutlined />
                      }
                      onClick={() => setRevealed((v) => !v)}
                      danger={revealed}
                    />
                  </Tooltip>
                  <Tooltip title="Copy password">
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyText(entry.password, "Password")}
                    />
                  </Tooltip>
                </Space>
              </div>
            </Descriptions.Item>

            {entry.url && (
              <Descriptions.Item label="URL">
                <a href={entry.url} target="_blank" rel="noopener noreferrer">
                  {entry.url}
                </a>
              </Descriptions.Item>
            )}

            <Descriptions.Item label="Expires">
              <Text type="secondary">
                {new Date(entry.expires_at).toLocaleString()}
              </Text>
            </Descriptions.Item>

            {entry.max_views > 0 && (
              <Descriptions.Item label="Views remaining">
                <Text
                  type={
                    entry.max_views - entry.view_count <= 1
                      ? "danger"
                      : "secondary"
                  }
                >
                  {Math.max(0, entry.max_views - entry.view_count)}
                </Text>
              </Descriptions.Item>
            )}
          </Descriptions>

          <div style={{ textAlign: "center" }}>
            <Space>
              <LockOutlined style={{ color: "#52c41a" }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Secured by IOP Password Vault · AES-256-GCM
              </Text>
            </Space>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default SharePage;

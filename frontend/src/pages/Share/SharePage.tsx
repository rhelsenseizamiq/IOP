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
  Input,
  Alert,
} from "antd";
import {
  EyeOutlined,
  EyeInvisibleOutlined,
  CopyOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  FileOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import { useParams } from "react-router-dom";
import { publicSharesApi } from "../../api/shares";
import type { SharedResource } from "../../types/share";

const { Title, Text } = Typography;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const SharePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [entry, setEntry] = useState<SharedResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  const applyError = (err: unknown): void => {
    const e = err as { response?: { status?: number; data?: { detail?: string } } };
    if (e.response?.status === 404) setError("This share link was not found.");
    else if (e.response?.status === 410)
      setError(e.response?.data?.detail ?? "This share link has expired or been revoked.");
    else if (e.response?.status === 429) setError("Too many requests. Please wait a moment and try again.");
    else setError("Failed to load shared content. The link may be invalid.");
  };

  useEffect(() => {
    if (!token) return;
    publicSharesApi
      .view(token)
      .then(setEntry)
      .catch((err) => {
        if (err.response?.status === 401 && err.response?.data?.detail === "password_required") {
          setNeedsPassword(true);
        } else {
          applyError(err);
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleUnlock = async () => {
    if (!token) return;
    setUnlocking(true);
    setPasswordError(null);
    try {
      const data = await publicSharesApi.unlock(token, passwordInput);
      setEntry(data);
      setNeedsPassword(false);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      setPasswordError(e.response?.status === 401 ? "Incorrect passphrase." : "Failed to unlock this link.");
    } finally {
      setUnlocking(false);
    }
  };

  const handleDownload = async () => {
    if (!token || !entry || entry.resource_type !== "file") return;
    setDownloading(true);
    try {
      await publicSharesApi.downloadFile(token, entry.filename, passwordInput || undefined);
    } catch {
      message.error("Download failed. The link may have expired or already been used.");
    } finally {
      setDownloading(false);
    }
  };

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
          background: "#1e1e28",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (needsPassword && !entry) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e1e28",
          padding: 24,
        }}
      >
        <Card style={{ width: "100%", maxWidth: 420, borderRadius: 12 }} title="Passphrase Required">
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Text type="secondary">This link is protected with an extra passphrase.</Text>
            <Input.Password
              placeholder="Passphrase"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onPressEnter={() => void handleUnlock()}
              autoFocus
            />
            {passwordError && <Alert type="error" message={passwordError} showIcon />}
            <Button type="primary" block loading={unlocking} onClick={() => void handleUnlock()}>
              Unlock
            </Button>
          </Space>
        </Card>
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
          background: "#1e1e28",
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

  if (entry.resource_type === "file") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#1e1e28",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Card
          style={{ width: "100%", maxWidth: 480, borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
          title={
            <Space>
              <SafetyCertificateOutlined style={{ color: "#52c41a" }} />
              <span>Shared File</span>
            </Space>
          }
        >
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            <div style={{ textAlign: "center" }}>
              <FileOutlined style={{ fontSize: 40, color: "#63e2b7" }} />
              <Title level={4} style={{ margin: "8px 0 0" }}>
                {entry.filename}
              </Title>
              <Text type="secondary">{formatSize(entry.size_bytes)}</Text>
            </div>

            {entry.note && (
              <Text type="secondary" style={{ fontStyle: "italic", display: "block", textAlign: "center" }}>
                {entry.note}
              </Text>
            )}

            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Expires">
                <Text type="secondary">
                  {entry.expires_at ? new Date(entry.expires_at).toLocaleString() : "Never"}
                </Text>
              </Descriptions.Item>
              {entry.max_views > 0 && (
                <Descriptions.Item label="Downloads remaining">
                  <Text type={entry.max_views - entry.view_count <= 1 ? "danger" : "secondary"}>
                    {Math.max(0, entry.max_views - entry.view_count)}
                  </Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            <Button type="primary" block icon={<DownloadOutlined />} loading={downloading} onClick={() => void handleDownload()}>
              Download
            </Button>

            <div style={{ textAlign: "center" }}>
              <Space>
                <LockOutlined style={{ color: "#52c41a" }} />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Encrypted at rest · Scanned for malware before sharing
                </Text>
              </Space>
            </div>
          </Space>
        </Card>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1e1e28",
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
                {entry.expires_at ? new Date(entry.expires_at).toLocaleString() : "Never"}
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

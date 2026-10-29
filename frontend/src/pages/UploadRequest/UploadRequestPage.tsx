import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Card,
  Typography,
  Space,
  Spin,
  Result,
  Upload,
  Button,
  Input,
  Progress,
  message,
} from "antd";
import { InboxOutlined, SafetyCertificateOutlined, CheckCircleFilled } from "@ant-design/icons";
import type { UploadFile } from "antd";
import { publicSharesApi } from "../../api/shares";
import type { UploadLinkInfo } from "../../types/share";

const { Title, Text, Paragraph } = Typography;

const PAGE_STYLE: React.CSSProperties = {
  minHeight: "100vh",
  background: "#1e1e28",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};

// Public, anonymous "send us a file" page for an upload-type share link —
// the mirror image of SharePage.tsx's download case. No login, no IOP
// account; the link itself is the only credential. See
// FILE_SHARING_PLAN.md §3a.
const UploadRequestPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<UploadLinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [password, setPassword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    publicSharesApi
      .viewUploadInfo(token)
      .then(setInfo)
      .catch(() => setInfo({ valid: false, has_password: false, note: null, expires_at: null }))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async () => {
    if (!token || fileList.length === 0 || !fileList[0].originFileObj) {
      message.warning("Choose a file first");
      return;
    }
    setUploading(true);
    setProgress(0);
    setError(null);
    try {
      const result = await publicSharesApi.upload(
        token,
        fileList[0].originFileObj,
        password || undefined,
        setProgress,
      );
      setDone(result.filename);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: string } } };
      const detail = e.response?.data?.detail;
      if (e.response?.status === 401) {
        setError(detail === "password_required" ? "This link requires a passphrase." : "Incorrect passphrase.");
      } else if (e.response?.status === 410) {
        setError(detail ?? "This link has already been used or has expired.");
      } else if (e.response?.status === 429) {
        setError("Too many attempts. Please wait a moment and try again.");
      } else {
        setError(detail ?? "Upload failed. The link may be invalid.");
      }
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div style={PAGE_STYLE}>
        <Spin size="large" />
      </div>
    );
  }

  if (!info?.valid) {
    return (
      <div style={PAGE_STYLE}>
        <Result status="404" title="Link Unavailable" subTitle="This upload link is invalid, expired, or has already been used." />
      </div>
    );
  }

  if (done) {
    return (
      <div style={PAGE_STYLE}>
        <Card style={{ width: "100%", maxWidth: 480, borderRadius: 12, textAlign: "center" }}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <CheckCircleFilled style={{ fontSize: 48, color: "#52c41a" }} />
            <Title level={4} style={{ margin: 0 }}>File received</Title>
            <Text type="secondary">
              <strong>{done}</strong> was uploaded successfully. You can close this page now.
            </Text>
          </Space>
        </Card>
      </div>
    );
  }

  return (
    <div style={PAGE_STYLE}>
      <Card
        style={{ width: "100%", maxWidth: 480, borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: "#52c41a" }} />
            <span>Send a File</span>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          {info.note && <Paragraph type="secondary">{info.note}</Paragraph>}

          <Upload.Dragger
            maxCount={1}
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: fl }) => setFileList(fl)}
            disabled={uploading}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag a file here</p>
            <p className="ant-upload-hint">Max 250 MB. This link accepts exactly one file.</p>
          </Upload.Dragger>

          {info.has_password && (
            <Input.Password
              placeholder="Passphrase"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={uploading}
            />
          )}

          {uploading && <Progress percent={progress} size="small" />}
          {error && <Text type="danger">{error}</Text>}

          <Button
            type="primary"
            block
            loading={uploading}
            disabled={fileList.length === 0}
            onClick={() => void handleSubmit()}
          >
            Send File
          </Button>

          <Text type="secondary" style={{ fontSize: 12, textAlign: "center", display: "block" }}>
            Encrypted at rest and scanned for malware before it reaches anyone.
          </Text>
        </Space>
      </Card>
    </div>
  );
};

export default UploadRequestPage;

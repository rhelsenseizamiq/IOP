import React, { useEffect, useState, useCallback } from "react";
import {
  Modal,
  Button,
  Form,
  InputNumber,
  Select,
  Input,
  Table,
  Tag,
  Space,
  Popconfirm,
  Typography,
  message,
  Divider,
  Tooltip,
} from "antd";
import {
  LinkOutlined,
  DeleteOutlined,
  CopyOutlined,
  PlusOutlined,
  LockOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { filesApi } from "../../api/files";
import type { ShareLink } from "../../types/share";

const { Text } = Typography;

interface Props {
  fileId: string;
  filename: string;
  open: boolean;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { label: "1 hour", value: 1 },
  { label: "6 hours", value: 6 },
  { label: "24 hours", value: 24 },
  { label: "3 days", value: 72 },
  { label: "7 days", value: 168 },
];

// Download-type share links for a file that already exists — same UX shape
// as Vault's ShareModal.tsx (pages/Vault/ShareModal.tsx), pointed at
// /files/{id}/shares instead of /passwords/{id}/shares. Deliberately a
// separate component rather than a generalized one: the two resource
// types' create payloads and recipient-facing behavior diverge enough
// (file size/scan-status vs. a password reveal) that sharing the exact
// component would need more conditional branching than just keeping two
// small, clear components.
const ShareFileModal: React.FC<Props> = ({ fileId, filename, open, onClose }) => {
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const fetchShares = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await filesApi.listShares(fileId);
      setShares(data);
    } catch {
      message.error("Failed to load share links");
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (open) {
      fetchShares();
      form.resetFields();
    }
  }, [open, fetchShares, form]);

  const handleCreate = async (values: {
    expires_in_hours: number;
    max_views: number;
    note?: string;
    password?: string;
  }) => {
    setCreating(true);
    try {
      await filesApi.createShare(fileId, {
        expires_in_hours: values.expires_in_hours,
        max_views: values.max_views ?? 0,
        note: values.note || null,
        password: values.password || null,
      });
      message.success("Share link created");
      form.resetFields();
      await fetchShares();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      message.error(e?.response?.data?.detail ?? "Failed to create share link");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await filesApi.revokeShare(shareId);
      message.success("Share link revoked");
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch {
      message.error("Failed to revoke share link");
    }
  };

  const copyLink = (shareUrl: string) => {
    navigator.clipboard.writeText(shareUrl).then(() => message.success("Link copied to clipboard"));
  };

  const columns = [
    {
      title: "Expires",
      dataIndex: "expires_at",
      key: "expires_at",
      render: (v: string | null) =>
        v ? (
          <Text type={dayjs(v).isBefore(dayjs()) ? "danger" : "secondary"}>
            {dayjs(v).format("MMM D, HH:mm")}
          </Text>
        ) : (
          <Tag>Never</Tag>
        ),
    },
    {
      title: "Views",
      key: "views",
      render: (_: unknown, r: ShareLink) => (
        <Text>
          {r.view_count}
          {r.max_views ? ` / ${r.max_views}` : ""}
        </Text>
      ),
    },
    {
      title: "Note",
      dataIndex: "note",
      key: "note",
      render: (v: string | null, r: ShareLink) => (
        <Space size={4}>
          {r.has_password && (
            <Tooltip title="Password-protected">
              <LockOutlined style={{ color: "#faad14" }} />
            </Tooltip>
          )}
          {v ? <Text type="secondary">{v}</Text> : !r.has_password && "—"}
        </Space>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 80,
      render: (_: unknown, r: ShareLink) => (
        <Space>
          <Tooltip title="Copy link">
            <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(r.share_url)} />
          </Tooltip>
          <Popconfirm
            title="Revoke this share link?"
            onConfirm={() => handleRevoke(r.id)}
            okText="Revoke"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Revoke">
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <LinkOutlined />
          Share — {filename}
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
      destroyOnClose
    >
      <Form form={form} layout="inline" onFinish={handleCreate} style={{ marginBottom: 16 }}>
        <Form.Item name="expires_in_hours" label="Expires" initialValue={24} rules={[{ required: true }]}>
          <Select options={EXPIRY_OPTIONS} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="max_views" label="Max views" initialValue={0}>
          <InputNumber min={0} style={{ width: 80 }} placeholder="∞" />
        </Form.Item>
        <Form.Item name="note" label="Note">
          <Input placeholder="Recipient note (optional)" style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="password" label="Passphrase">
          <Input.Password placeholder="Optional extra passphrase" style={{ width: 160 }} visibilityToggle />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={creating} icon={<PlusOutlined />}>
            Create
          </Button>
        </Form.Item>
      </Form>

      <Divider style={{ margin: "12px 0" }} />

      <Table
        dataSource={shares}
        columns={columns}
        rowKey="id"
        size="small"
        loading={loading}
        pagination={false}
        locale={{ emptyText: "No active share links" }}
      />
    </Modal>
  );
};

export default ShareFileModal;

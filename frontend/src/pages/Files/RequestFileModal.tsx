import React, { useState } from "react";
import { Modal, Button, Form, Select, Input, Space, Typography, message, Alert } from "antd";
import { LinkOutlined, CopyOutlined, PlusOutlined } from "@ant-design/icons";
import { filesApi } from "../../api/files";
import type { ShareLink } from "../../types/share";

const { Text, Paragraph } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { label: "1 hour", value: 1 },
  { label: "24 hours", value: 24 },
  { label: "3 days", value: 72 },
  { label: "7 days", value: 168 },
  { label: "30 days", value: 720 },
];

// Creates an "upload-request" link — no file attached yet, since nothing
// exists to share. The vendor who opens the resulting link gets a plain
// upload box, no login, exactly like a download-type share link but in
// reverse. See FILE_SHARING_PLAN.md §3a.
const RequestFileModal: React.FC<Props> = ({ open, onClose }) => {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ShareLink | null>(null);
  const [form] = Form.useForm();

  const handleClose = (): void => {
    setCreated(null);
    form.resetFields();
    onClose();
  };

  const handleCreate = async (values: { expires_in_hours: number; note?: string; password?: string }) => {
    setCreating(true);
    try {
      const { data } = await filesApi.createUploadRequest({
        expires_in_hours: values.expires_in_hours,
        note: values.note || null,
        password: values.password || null,
      });
      setCreated(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      message.error(e?.response?.data?.detail ?? "Failed to create upload link");
    } finally {
      setCreating(false);
    }
  };

  const copyLink = (shareUrl: string) => {
    navigator.clipboard.writeText(shareUrl).then(() => message.success("Link copied to clipboard"));
  };

  return (
    <Modal
      title={
        <Space>
          <LinkOutlined />
          Request a File
        </Space>
      }
      open={open}
      onCancel={handleClose}
      footer={<Button onClick={handleClose}>Close</Button>}
      width={520}
      destroyOnClose
    >
      {!created ? (
        <>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            Creates a one-time link you can send to someone with no IOP account — they open it,
            upload a file, done. No username or password required on their end. The file lands in
            your Files list once it's scanned, visible only to you.
          </Paragraph>
          <Form form={form} layout="vertical" onFinish={handleCreate}>
            <Form.Item name="expires_in_hours" label="Expires" initialValue={72} rules={[{ required: true }]}>
              <Select options={EXPIRY_OPTIONS} />
            </Form.Item>
            <Form.Item name="note" label="Label (for your own records)">
              <Input placeholder='e.g. "VendorX invoice request"' maxLength={500} />
            </Form.Item>
            <Form.Item name="password" label="Passphrase (optional)">
              <Input.Password placeholder="Extra passphrase the vendor must enter" visibilityToggle />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={creating} icon={<PlusOutlined />}>
                Create Link
              </Button>
            </Form.Item>
          </Form>
        </>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Alert
            type="success"
            showIcon
            message="Upload link created"
            description="Send this to whoever needs to send you a file. It accepts exactly one upload, then stops working."
          />
          <Space.Compact style={{ width: "100%" }}>
            <Input value={created.share_url} readOnly />
            <Button icon={<CopyOutlined />} onClick={() => copyLink(created.share_url)}>
              Copy
            </Button>
          </Space.Compact>
          {created.has_password && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Remember to share the passphrase with them separately from the link itself.
            </Text>
          )}
        </Space>
      )}
    </Modal>
  );
};

export default RequestFileModal;

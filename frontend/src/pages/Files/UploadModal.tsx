import React, { useState } from "react";
import {
  Modal,
  Upload,
  Button,
  Space,
  Typography,
  Form,
  Input,
  Checkbox,
  DatePicker,
  Progress,
  message,
} from "antd";
import { UploadOutlined, InboxOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd";
import dayjs from "dayjs";
import { filesApi } from "../../api/files";

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

const UploadModal: React.FC<Props> = ({ open, onClose, onUploaded }) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [form] = Form.useForm();

  const reset = (): void => {
    setFileList([]);
    setProgress(0);
    form.resetFields();
  };

  const handleClose = (): void => {
    reset();
    onClose();
  };

  const handleUpload = async (): Promise<void> => {
    if (fileList.length === 0 || !fileList[0].originFileObj) {
      message.warning("Please select a file first");
      return;
    }
    let values: { description?: string; tags?: string; delete_after_first_download?: boolean; expires_at: dayjs.Dayjs };
    try {
      values = await form.validateFields();
    } catch {
      return; // form shows its own validation errors (expires_at is required)
    }
    setUploading(true);
    setProgress(0);
    try {
      await filesApi.upload(
        fileList[0].originFileObj,
        {
          description: values.description || undefined,
          tags: values.tags
            ? values.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
            : [],
          delete_after_first_download: !!values.delete_after_first_download,
          expires_at: values.expires_at.toISOString(),
        },
        setProgress,
      );
      message.success("File uploaded — scanning now, it'll be available once the scan completes");
      reset();
      onUploaded();
      onClose();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      title="Upload File"
      open={open}
      onCancel={handleClose}
      width={520}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            loading={uploading}
            disabled={fileList.length === 0}
            onClick={() => void handleUpload()}
          >
            Upload
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size={16}>
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
          <p className="ant-upload-hint">Max 250 MB. Scanned for malware before it's available.</p>
        </Upload.Dragger>

        {uploading && <Progress percent={progress} size="small" />}

        <Form form={form} layout="vertical" disabled={uploading}>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Optional" maxLength={2000} />
          </Form.Item>
          <Form.Item name="tags" label="Tags">
            <Input placeholder="Comma-separated, optional" />
          </Form.Item>
          <Form.Item
            name="expires_at"
            label="Delete on"
            required
            tooltip="You choose when this file gets deleted — the app never deletes a file on its own. Max 30 days from today."
            rules={[
              { required: true, message: "Pick a deletion date — required for every upload" },
              {
                validator: (_, value: dayjs.Dayjs | undefined) => {
                  if (!value) return Promise.resolve();
                  if (value.isBefore(dayjs())) {
                    return Promise.reject(new Error("Must be in the future"));
                  }
                  if (value.isAfter(dayjs().add(30, "day"))) {
                    return Promise.reject(new Error("Cannot be more than 30 days from today"));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <DatePicker
              showTime
              style={{ width: "100%" }}
              disabledDate={(d) => !d || d.endOf("day").isBefore(dayjs()) || d.startOf("day").isAfter(dayjs().add(30, "day"))}
              placeholder="When should this file be deleted?"
            />
          </Form.Item>
          <Form.Item name="delete_after_first_download" valuePropName="checked">
            <Checkbox>Delete after first download</Checkbox>
          </Form.Item>
        </Form>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Encrypted at rest. Every upload is scanned by ClamAV before it can be downloaded or shared.
        </Typography.Text>
      </Space>
    </Modal>
  );
};

export default UploadModal;

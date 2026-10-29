import React, { useEffect, useState, useCallback } from "react";
import {
  Typography,
  Table,
  Button,
  Input,
  Space,
  Tag,
  Tooltip,
  Popconfirm,
  message,
  Alert,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import {
  UploadOutlined,
  LinkOutlined,
  DownloadOutlined,
  DeleteOutlined,
  SearchOutlined,
  FileOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { filesApi } from "../../api/files";
import { useAuth } from "../../context/AuthContext";
import UploadModal from "./UploadModal";
import ShareFileModal from "./ShareFileModal";
import RequestFileModal from "./RequestFileModal";
import type { FileEntry, ScanStatus } from "../../types/file";

const PAGE_SIZE = 20;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const SCAN_STATUS_META: Record<ScanStatus, { color: string; label: string }> = {
  pending: { color: "processing", label: "Scanning…" },
  clean: { color: "success", label: "Clean" },
  infected: { color: "error", label: "Infected" },
  scan_failed: { color: "warning", label: "Scan failed" },
};

const FilesPage: React.FC = () => {
  const { hasRole } = useAuth();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<FileEntry | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await filesApi.list({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
      });
      setFiles(data.items);
      setTotal(data.total);
    } catch {
      message.error("Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Pending/scanning files aren't static — poll gently while any are in
  // that state so the list updates itself once a scan completes, instead
  // of the user needing to hit Refresh.
  useEffect(() => {
    if (!files.some((f) => f.scan_status === "pending")) return;
    const interval = setInterval(fetchFiles, 5000);
    return () => clearInterval(interval);
  }, [files, fetchFiles]);

  const handleDownload = async (file: FileEntry) => {
    setDownloadingId(file.id);
    try {
      await filesApi.download(file.id, file.filename);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      message.error(e?.response?.data?.detail ?? "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (file: FileEntry) => {
    try {
      await filesApi.delete(file.id);
      message.success("File deleted");
      fetchFiles();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      message.error(e?.response?.data?.detail ?? "Delete failed");
    }
  };

  const columns: ColumnsType<FileEntry> = [
    {
      title: "Filename",
      dataIndex: "filename",
      key: "filename",
      render: (v: string, r) => (
        <Space>
          <FileOutlined />
          <span>{v}</span>
          {r.delete_after_first_download && (
            <Tooltip title="Deletes itself after first download">
              <Tag color="gold">one-shot</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: "Size",
      dataIndex: "size_bytes",
      key: "size_bytes",
      width: 100,
      render: formatSize,
    },
    {
      title: "Status",
      dataIndex: "scan_status",
      key: "scan_status",
      width: 120,
      render: (v: ScanStatus) => <Tag color={SCAN_STATUS_META[v].color}>{SCAN_STATUS_META[v].label}</Tag>,
    },
    {
      title: "Uploaded",
      dataIndex: "created_at",
      key: "created_at",
      width: 160,
      render: (v: string, r) => (
        <Tooltip title={r.created_by}>{dayjs(v).format("MMM D, YYYY HH:mm")}</Tooltip>
      ),
    },
    {
      title: "Expires",
      dataIndex: "expires_at",
      key: "expires_at",
      width: 140,
      render: (v: string | null) => (v ? dayjs(v).format("MMM D, YYYY") : <Tag>Never</Tag>),
    },
    {
      title: "",
      key: "actions",
      width: 140,
      render: (_: unknown, r: FileEntry) => (
        <Space>
          <Tooltip title={r.scan_status === "clean" ? "Download" : "Not available yet"}>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={downloadingId === r.id}
              disabled={r.scan_status !== "clean"}
              onClick={() => handleDownload(r)}
            />
          </Tooltip>
          <Tooltip title={r.scan_status === "clean" ? "Share" : "Not available yet"}>
            <Button
              size="small"
              icon={<LinkOutlined />}
              disabled={r.scan_status !== "clean"}
              onClick={() => setShareTarget(r)}
            />
          </Tooltip>
          {hasRole("Administrator") && (
            <Popconfirm title="Delete this file? This cannot be undone." onConfirm={() => handleDelete(r)} okText="Delete" okButtonProps={{ danger: true }}>
              <Tooltip title="Delete">
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize: PAGE_SIZE,
    total,
    showSizeChanger: false,
    onChange: (p) => setPage(p),
  };

  return (
    <div>
      <Typography.Title level={4}>Files</Typography.Title>
      <Typography.Paragraph type="secondary">
        Encrypted file storage with temporary share links — download links for sending a file to
        anyone (inside or outside the bank), or request links for having someone send you one with
        no account needed.
      </Typography.Paragraph>

      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Input
          placeholder="Search filename, description, tags"
          prefix={<SearchOutlined />}
          allowClear
          style={{ width: 280 }}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchFiles}>
            Refresh
          </Button>
          {hasRole("Operator") && (
            <>
              <Button icon={<LinkOutlined />} onClick={() => setRequestOpen(true)}>
                Request a File
              </Button>
              <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
                Upload
              </Button>
            </>
          )}
        </Space>
      </Space>

      {files.some((f) => f.scan_status === "infected" || f.scan_status === "scan_failed") && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="One or more files need attention (infected or failed to scan) — see the Status column."
        />
      )}

      <Table
        dataSource={files}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={pagination}
      />

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={fetchFiles} />
      <RequestFileModal open={requestOpen} onClose={() => setRequestOpen(false)} />
      {shareTarget && (
        <ShareFileModal
          fileId={shareTarget.id}
          filename={shareTarget.filename}
          open={!!shareTarget}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
};

export default FilesPage;

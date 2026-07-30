import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  FolderOutlined,
  HolderOutlined,
  LinkOutlined,
  LoadingOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { passwordsApi } from "../../api/vault";
import type { PasswordEntry } from "../../types/vault";
import { useReveal } from "./useReveal";
import PasswordEntryModal from "./PasswordEntryModal";
import ShareModal from "./ShareModal";

interface Props {
  cabinetId: string;
  folderId: string | null;
  showAllFolders: boolean;
  canEdit: boolean;
  onDragStart: (entryId: string) => void;
  onDragEnd: () => void;
  refreshVersion: number;
}

const PasswordTable: React.FC<Props> = ({
  cabinetId,
  folderId,
  showAllFolders,
  canEdit,
  onDragStart,
  onDragEnd,
  refreshVersion,
}) => {
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<PasswordEntry | null>(null);
  const [shareEntry, setShareEntry] = useState<PasswordEntry | null>(null);

  const {
    revealState,
    copyingId,
    revealPassword,
    copyPassword,
    clearReveal,
    copyToClipboard,
  } = useReveal();

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const folderParam = showAllFolders ? undefined : folderId;
      const res = await passwordsApi.list(cabinetId, page, 50, folderParam);
      setEntries(res.data.items);
      setTotal(res.data.total);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      message.error(
        axiosErr.response?.data?.detail ?? "Failed to load entries",
      );
    } finally {
      setLoading(false);
    }
  }, [cabinetId, page, folderId, showAllFolders]);

  useEffect(() => {
    setPage(1);
    clearReveal();
  }, [cabinetId, folderId, showAllFolders, clearReveal]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    if (refreshVersion > 0) fetchEntries();
  }, [refreshVersion, fetchEntries]);

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await passwordsApi.delete(id);
      message.success("Entry deleted");
      fetchEntries();
    } catch {
      message.error("Failed to delete entry");
    }
  };

  const isRevealing = (id: string) =>
    revealState.loading && revealState.entryId === id;
  const isRevealed = (id: string) =>
    !revealState.loading &&
    revealState.entryId === id &&
    revealState.password !== null;

  const columns: ColumnsType<PasswordEntry> = [
    ...(canEdit
      ? [
          {
            key: "drag",
            width: 24,
            render: () => (
              <HolderOutlined style={{ color: "#d9d9d9", cursor: "grab" }} />
            ),
          } as ColumnsType<PasswordEntry>[0],
        ]
      : []),
    {
      title: "Title",
      dataIndex: "title",
      key: "title",
      render: (title: string) => (
        <Typography.Text strong>{title}</Typography.Text>
      ),
    },
    {
      title: "Username",
      dataIndex: "username",
      key: "username",
      render: (val: string | null) =>
        val ? (
          <Space>
            <Typography.Text code>{val}</Typography.Text>
            <Tooltip title="Copy username">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyToClipboard(val)}
              />
            </Tooltip>
          </Space>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "URL",
      dataIndex: "url",
      key: "url",
      render: (val: string | null) =>
        val ? (
          <Typography.Link href={val} target="_blank" rel="noopener noreferrer">
            {val.length > 40 ? `${val.slice(0, 40)}…` : val}
          </Typography.Link>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    ...(showAllFolders
      ? [
          {
            title: "Folder",
            dataIndex: "folder_id",
            key: "folder_id",
            width: 120,
            render: (fid: string | null) =>
              fid ? (
                <Tag icon={<FolderOutlined />} color="default">
                  {fid.slice(-6)}
                </Tag>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          } as ColumnsType<PasswordEntry>[0],
        ]
      : []),
    {
      title: "Tags",
      dataIndex: "tags",
      key: "tags",
      render: (tags: string[]) =>
        tags.length > 0 ? (
          tags.map((t) => <Tag key={t}>{t}</Tag>)
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Password",
      key: "password",
      render: (_, record) => {
        if (isRevealing(record.id)) return <LoadingOutlined />;
        if (isRevealed(record.id)) {
          return (
            <Space>
              <Typography.Text code>{revealState.password}</Typography.Text>
              <Tooltip title="Copy password">
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyToClipboard(revealState.password!)}
                />
              </Tooltip>
              <Tooltip title={`Clears in ${revealState.secondsLeft}s`}>
                <Button
                  type="text"
                  size="small"
                  icon={<EyeInvisibleOutlined />}
                  onClick={clearReveal}
                />
              </Tooltip>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {revealState.secondsLeft}s
              </Typography.Text>
            </Space>
          );
        }
        return (
          <Space size={4}>
            <Tooltip title="Copy password to clipboard (without revealing)">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                loading={copyingId === record.id}
                onClick={() => copyPassword(record.id)}
              />
            </Tooltip>
            <Tooltip title="Reveal password for 30s">
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => revealPassword(record.id)}
              >
                Reveal Password
              </Button>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 130,
      render: (_, record) => (
        <Space>
          <Tooltip title="Share link">
            <Button
              type="text"
              size="small"
              icon={<LinkOutlined />}
              onClick={() => setShareEntry(record)}
            />
          </Tooltip>
          {canEdit && (
            <>
              <Tooltip title="Edit">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditEntry(record);
                    setModalOpen(true);
                  }}
                />
              </Tooltip>
              <Popconfirm
                title="Delete this entry?"
                onConfirm={() => handleDelete(record.id)}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title="Delete">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 12, textAlign: "right" }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditEntry(null);
              setModalOpen(true);
            }}
          >
            Add Entry
          </Button>
        </div>
      )}

      <Table
        rowKey="id"
        dataSource={entries}
        columns={columns}
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 50,
          onChange: setPage,
          showTotal: (t) => `${t} entries`,
        }}
        size="small"
        onRow={
          canEdit
            ? (record) => ({
                draggable: true,
                onDragStart: (e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", record.id);
                  onDragStart(record.id);
                },
                onDragEnd: () => onDragEnd(),
                style: { cursor: "grab" },
              })
            : undefined
        }
      />

      <PasswordEntryModal
        open={modalOpen}
        cabinetId={cabinetId}
        folderId={folderId}
        entry={editEntry}
        onClose={() => setModalOpen(false)}
        onSaved={fetchEntries}
      />

      {shareEntry && (
        <ShareModal
          entryId={shareEntry.id}
          entryTitle={shareEntry.title}
          open={!!shareEntry}
          onClose={() => setShareEntry(null)}
        />
      )}
    </div>
  );
};

export default PasswordTable;

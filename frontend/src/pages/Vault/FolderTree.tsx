import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Input,
  message,
  Popconfirm,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  InboxOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { foldersApi } from '../../api/vault';
import type { Folder } from '../../types/vault';

export type FolderSelection = { type: 'all' } | { type: 'folder'; folderId: string };

interface Props {
  cabinetId: string;
  cabinetName: string;
  selection: FolderSelection;
  onSelect: (sel: FolderSelection) => void;
  onBack: () => void;
  canEdit: boolean;
  draggingEntryId: string | null;
  onDropToFolder: (entryId: string, folderId: string | null) => void;
}

interface FolderNode {
  folder: Folder;
  children: FolderNode[];
}

function buildTree(folders: Folder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  folders.forEach((f) => map.set(f.id, { folder: f, children: [] }));
  const roots: FolderNode[] = [];
  folders.forEach((f) => {
    const node = map.get(f.id)!;
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

const FolderTree: React.FC<Props> = ({
  cabinetId,
  cabinetName,
  selection,
  onSelect,
  onBack,
  canEdit,
  draggingEntryId,
  onDropToFolder,
}) => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [dragOverId, setDragOverId] = useState<string | 'root' | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [addingName, setAddingName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const addInputRef = useRef<any>(null);
  const editInputRef = useRef<any>(null);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await foldersApi.list(cabinetId);
      setFolders(res.data);
    } catch {
      message.error('Failed to load folders');
    }
  }, [cabinetId]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  useEffect(() => {
    if (addingIn !== null) setTimeout(() => addInputRef.current?.focus(), 50);
  }, [addingIn]);

  useEffect(() => {
    if (editingId !== null) setTimeout(() => editInputRef.current?.focus(), 50);
  }, [editingId]);

  const handleCreate = async (parentId: string | null) => {
    const name = addingName.trim();
    if (!name) { setAddingIn(null); return; }
    try {
      await foldersApi.create({ cabinet_id: cabinetId, parent_id: parentId, name });
      message.success('Folder created');
      setAddingIn(null);
      setAddingName('');
      fetchFolders();
    } catch (err: any) {
      message.error(err?.response?.data?.detail ?? 'Failed to create folder');
    }
  };

  const handleRename = async (id: string) => {
    const name = editingName.trim();
    if (!name) { setEditingId(null); return; }
    try {
      await foldersApi.update(id, { name });
      message.success('Folder renamed');
      setEditingId(null);
      setEditingName('');
      fetchFolders();
    } catch (err: any) {
      message.error(err?.response?.data?.detail ?? 'Failed to rename folder');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await foldersApi.delete(id);
      message.success('Folder deleted');
      if (selection.type === 'folder' && selection.folderId === id) {
        onSelect({ type: 'all' });
      }
      fetchFolders();
    } catch {
      message.error('Failed to delete folder');
    }
  };

  const isSelected = (folderId: string) =>
    selection.type === 'folder' && selection.folderId === folderId;
  const isAllSelected = selection.type === 'all';

  const handleDragOver = (e: React.DragEvent, id: string | 'root') => {
    if (!draggingEntryId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDragOverId(null);
    if (draggingEntryId) onDropToFolder(draggingEntryId, folderId);
  };

  const renderNode = (node: FolderNode, depth = 0): React.ReactNode => {
    const { folder, children } = node;
    const selected = isSelected(folder.id);
    const isDragOver = dragOverId === folder.id;

    return (
      <div key={folder.id}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: `6px 8px 6px ${16 + depth * 16}px`,
            cursor: 'pointer',
            borderRadius: 6,
            backgroundColor: isDragOver
              ? '#d4edda'
              : selected
              ? '#e6f4ff'
              : undefined,
            borderLeft: selected ? '3px solid #1677ff' : '3px solid transparent',
            borderRight: isDragOver ? '2px dashed #52c41a' : undefined,
            transition: 'background 0.15s',
          }}
          onClick={() => onSelect({ type: 'folder', folderId: folder.id })}
          onDragOver={(e) => handleDragOver(e, folder.id)}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => handleDrop(e, folder.id)}
        >
          {editingId === folder.id ? (
            <Input
              ref={editInputRef}
              size="small"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onPressEnter={() => handleRename(folder.id)}
              onBlur={() => handleRename(folder.id)}
              style={{ flex: 1, maxWidth: 140 }}
              maxLength={100}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              {children.length > 0 ? (
                <FolderOpenOutlined style={{ color: '#faad14', marginRight: 6 }} />
              ) : (
                <FolderOutlined style={{ color: '#faad14', marginRight: 6 }} />
              )}
              <Typography.Text
                style={{ flex: 1, fontSize: 13, color: selected ? '#1677ff' : undefined }}
                ellipsis
              >
                {folder.name}
              </Typography.Text>
            </>
          )}
          {canEdit && editingId !== folder.id && (
            <Space size={2} style={{ marginLeft: 4 }} onClick={(e) => e.stopPropagation()}>
              <Tooltip title="Add subfolder">
                <Button
                  type="text"
                  size="small"
                  icon={<FolderAddOutlined />}
                  onClick={() => { setAddingIn(folder.id); setAddingName(''); }}
                />
              </Tooltip>
              <Tooltip title="Rename">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => { setEditingId(folder.id); setEditingName(folder.name); }}
                />
              </Tooltip>
              <Popconfirm
                title={`Delete folder "${folder.name}" and move its entries to root?`}
                onConfirm={() => handleDelete(folder.id)}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title="Delete">
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Tooltip>
              </Popconfirm>
            </Space>
          )}
        </div>

        {addingIn === folder.id && (
          <div style={{ padding: `4px 8px 4px ${28 + depth * 16}px` }}>
            <Input
              ref={addInputRef}
              size="small"
              placeholder="Folder name"
              value={addingName}
              onChange={(e) => setAddingName(e.target.value)}
              onPressEnter={() => handleCreate(folder.id)}
              onBlur={() => handleCreate(folder.id)}
              maxLength={100}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const tree = buildTree(folders);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Tooltip title="Back to cabinets">
          <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={onBack} />
        </Tooltip>
        <Typography.Text strong ellipsis style={{ flex: 1, fontSize: 13 }}>
          {cabinetName}
        </Typography.Text>
        {canEdit && (
          <Tooltip title="New top-level folder">
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => { setAddingIn('__root__'); setAddingName(''); }}
            />
          </Tooltip>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {/* All entries node */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 8px 6px 16px',
            cursor: 'pointer',
            borderRadius: 6,
            backgroundColor: dragOverId === 'root' ? '#d4edda' : isAllSelected ? '#e6f4ff' : undefined,
            borderLeft: isAllSelected ? '3px solid #1677ff' : '3px solid transparent',
            borderRight: dragOverId === 'root' ? '2px dashed #52c41a' : undefined,
            transition: 'background 0.15s',
          }}
          onClick={() => onSelect({ type: 'all' })}
          onDragOver={(e) => handleDragOver(e, 'root')}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => handleDrop(e, null)}
        >
          <InboxOutlined style={{ color: '#8c8c8c', marginRight: 6 }} />
          <Typography.Text style={{ flex: 1, fontSize: 13, color: isAllSelected ? '#1677ff' : '#8c8c8c' }}>
            All entries
          </Typography.Text>
        </div>

        {/* Tree nodes */}
        {tree.map((node) => renderNode(node, 0))}

        {/* New root-level folder input */}
        {addingIn === '__root__' && (
          <div style={{ padding: '4px 8px 4px 16px' }}>
            <Input
              ref={addInputRef}
              size="small"
              placeholder="New folder name"
              value={addingName}
              onChange={(e) => setAddingName(e.target.value)}
              onPressEnter={() => handleCreate(null)}
              onBlur={() => handleCreate(null)}
              maxLength={100}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {folders.length === 0 && addingIn === null && canEdit && (
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              No folders yet. Click + to create one.
            </Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
};

export default FolderTree;

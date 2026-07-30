import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Form,
  Input,
  Modal,
  Select,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { FolderOutlined, PlusOutlined } from '@ant-design/icons';
import { foldersApi, passwordsApi } from '../../api/vault';
import type { Folder, PasswordEntry, PasswordEntryCreate, PasswordEntryUpdate } from '../../types/vault';

interface Props {
  open: boolean;
  cabinetId: string;
  folderId: string | null;
  entry: PasswordEntry | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  title: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  folder_id?: string;
}

const MAX_TAGS = 20;
const MAX_TAG_LEN = 50;

const PasswordEntryModal: React.FC<Props> = ({ open, cabinetId, folderId, entry, onClose, onSaved }) => {
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const isEdit = entry !== null;

  const [tags, setTags] = useState<string[]>([]);
  const [tagInputVisible, setTagInputVisible] = useState(false);
  const [tagInputValue, setTagInputValue] = useState('');
  const tagInputRef = useRef<any>(null);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await foldersApi.list(cabinetId);
      setFolders(res.data);
    } catch {
      // non-critical
    }
  }, [cabinetId]);

  useEffect(() => {
    if (open) {
      fetchFolders();
      if (entry) {
        form.setFieldsValue({
          title: entry.title,
          username: entry.username ?? undefined,
          url: entry.url ?? undefined,
          folder_id: entry.folder_id ?? undefined,
        });
        setTags(entry.tags ?? []);
      } else {
        form.resetFields();
        form.setFieldsValue({ folder_id: folderId ?? undefined });
        setTags([]);
      }
      setTagInputVisible(false);
      setTagInputValue('');
    }
  }, [open, entry, form, folderId, fetchFolders]);

  useEffect(() => {
    if (tagInputVisible) setTimeout(() => tagInputRef.current?.focus(), 50);
  }, [tagInputVisible]);

  const handleTagClose = (removed: string): void => {
    setTags((prev) => prev.filter((t) => t !== removed));
  };

  const confirmTagInput = (): void => {
    const val = tagInputValue.trim();
    if (!val) { setTagInputVisible(false); setTagInputValue(''); return; }
    if (val.length > MAX_TAG_LEN) { message.warning(`Tag must be at most ${MAX_TAG_LEN} characters`); return; }
    if (tags.includes(val)) { message.warning('Tag already added'); setTagInputValue(''); return; }
    if (tags.length >= MAX_TAGS) { message.warning(`Maximum ${MAX_TAGS} tags allowed`); return; }
    setTags((prev) => [...prev, val]);
    setTagInputVisible(false);
    setTagInputValue('');
  };

  const handleOk = async (): Promise<void> => {
    let values: FormValues;
    try { values = await form.validateFields(); } catch { return; }

    setLoading(true);
    try {
      if (isEdit) {
        const update: PasswordEntryUpdate = {
          title: values.title,
          username: values.username,
          url: values.url,
          notes: values.notes,
          tags,
          folder_id: values.folder_id ?? null,
        };
        if (values.password) update.password = values.password;
        await passwordsApi.update(entry.id, update);
        message.success('Entry updated');
      } else {
        const create: PasswordEntryCreate = {
          cabinet_id: cabinetId,
          folder_id: values.folder_id ?? null,
          title: values.title,
          username: values.username,
          password: values.password!,
          url: values.url,
          notes: values.notes,
          tags,
        };
        await passwordsApi.create(create);
        message.success('Entry created');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      message.error(axiosErr.response?.data?.detail ?? 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  const buildFolderOptions = (folderList: Folder[]): { label: React.ReactNode; value: string; children?: Folder[] }[] => {
    const roots = folderList.filter((f) => f.parent_id === null);
    const byParent = new Map<string, Folder[]>();
    folderList.forEach((f) => {
      if (f.parent_id) {
        const arr = byParent.get(f.parent_id) ?? [];
        arr.push(f);
        byParent.set(f.parent_id, arr);
      }
    });
    const buildOptions = (items: Folder[], depth = 0): any[] =>
      items.flatMap((f) => [
        {
          label: (
            <span>
              {'  '.repeat(depth)}
              <FolderOutlined style={{ color: '#faad14', marginRight: 4 }} />
              {f.name}
            </span>
          ),
          value: f.id,
        },
        ...buildOptions(byParent.get(f.id) ?? [], depth + 1),
      ]);
    return buildOptions(roots);
  };

  return (
    <Modal
      open={open}
      title={isEdit ? 'Edit Entry' : 'Add Entry'}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      destroyOnClose
      width={520}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
          <Input placeholder="e.g. Production DB Root" maxLength={200} />
        </Form.Item>

        <Form.Item name="folder_id" label="Folder">
          <Select
            allowClear
            placeholder="— No folder (root) —"
            options={buildFolderOptions(folders)}
            suffixIcon={<FolderOutlined />}
          />
        </Form.Item>

        <Form.Item name="username" label="Username">
          <Input placeholder="Optional username / account" maxLength={200} />
        </Form.Item>

        <Form.Item
          name="password"
          label="Password"
          rules={isEdit ? [] : [{ required: true, message: 'Password is required' }]}
        >
          <Input.Password
            placeholder={isEdit ? 'Leave blank to keep current password' : 'Enter password'}
            maxLength={1000}
          />
        </Form.Item>

        <Form.Item name="url" label="URL">
          <Input placeholder="https://..." maxLength={2048} />
        </Form.Item>

        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={3} placeholder="Additional notes" maxLength={5000} />
        </Form.Item>

        <Form.Item label="Tags">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {tags.map((tag) => (
              <Tag key={tag} closable onClose={() => handleTagClose(tag)} style={{ userSelect: 'none' }}>
                {tag}
              </Tag>
            ))}
            {tagInputVisible ? (
              <Input
                ref={tagInputRef}
                size="small"
                value={tagInputValue}
                onChange={(e) => setTagInputValue(e.target.value)}
                onBlur={confirmTagInput}
                onPressEnter={confirmTagInput}
                placeholder="New tag"
                style={{ width: 100 }}
                maxLength={MAX_TAG_LEN}
              />
            ) : (
              tags.length < MAX_TAGS && (
                <Tooltip title="Add tag">
                  <Tag
                    onClick={() => setTagInputVisible(true)}
                    style={{ cursor: 'pointer', borderStyle: 'dashed', background: 'transparent' }}
                  >
                    <PlusOutlined /> New Tag
                  </Tag>
                </Tooltip>
              )
            )}
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default PasswordEntryModal;

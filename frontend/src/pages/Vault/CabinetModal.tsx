import React, { useEffect, useState } from 'react';
import { Form, Input, Modal, Select, message } from 'antd';
import { cabinetsApi } from '../../api/vault';
import { usersApi } from '../../api/users';
import type { Cabinet, CabinetCreate, CabinetUpdate } from '../../types/vault';
import type { User } from '../../types/user';

interface Props {
  open: boolean;
  cabinet: Cabinet | null;
  isSuperAdmin: boolean;
  currentUsername: string | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  name: string;
  description?: string;
  member_usernames?: string[];
}

const CabinetModal: React.FC<Props> = ({ open, cabinet, isSuperAdmin, currentUsername, onClose, onSaved }) => {
  // SuperAdmin: any cabinet. Administrator: only their own cabinets.
  const canManageMembers = isSuperAdmin || (cabinet?.created_by === currentUsername);
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const isEdit = cabinet !== null;

  useEffect(() => {
    if (open) {
      if (canManageMembers) {
        usersApi.list({ page_size: 200 }).then((res) => setUsers(res.data.items)).catch(() => {});
      }
      if (cabinet) {
        form.setFieldsValue({
          name: cabinet.name,
          description: cabinet.description ?? undefined,
          member_usernames: cabinet.member_usernames,
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, cabinet, form, isSuperAdmin]);

  const handleOk = async (): Promise<void> => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setLoading(true);
    try {
      if (isEdit) {
        const update: CabinetUpdate = { name: values.name, description: values.description };
        await cabinetsApi.update(cabinet.id, update);
        if (canManageMembers) {
          const newMembers = values.member_usernames ?? [];
          const current = cabinet.member_usernames;
          const toAdd = newMembers.filter((u) => !current.includes(u));
          const toRemove = current.filter((u) => !newMembers.includes(u));
          if (toAdd.length > 0) await cabinetsApi.addMembers(cabinet.id, toAdd);
          for (const u of toRemove) await cabinetsApi.removeMember(cabinet.id, u);
        }
        message.success('Cabinet updated');
      } else {
        const create: CabinetCreate = {
          name: values.name,
          description: values.description,
          member_usernames: canManageMembers ? (values.member_usernames ?? []) : [],
        };
        await cabinetsApi.create(create);
        message.success('Cabinet created');
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

  const userOptions = users.map((u) => ({ label: u.username, value: u.username }));

  return (
    <Modal
      open={open}
      title={isEdit ? 'Edit Cabinet' : 'New Cabinet'}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      destroyOnClose
      width={500}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="Cabinet Name"
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. Linux Admins" maxLength={100} />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} placeholder="Optional description" maxLength={500} />
        </Form.Item>
        {canManageMembers && (
          <Form.Item name="member_usernames" label="Members">
            <Select
              mode="multiple"
              options={userOptions}
              placeholder="Select members"
              filterOption={(input, opt) =>
                (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              allowClear
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

export default CabinetModal;

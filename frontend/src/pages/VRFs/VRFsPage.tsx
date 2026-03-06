import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Switch,
  message,
  Popconfirm,
  Typography,
  Tag,
  Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { vrfsApi } from '../../api/vrfs';
import { useAuth } from '../../context/AuthContext';
import type { VRF, VRFCreate, VRFUpdate } from '../../types/vrf';

const PAGE_SIZE = 20;

const VRFsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const [vrfs, setVrfs] = useState<VRF[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVrf, setEditingVrf] = useState<VRF | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<VRFCreate & VRFUpdate>();

  const fetchVrfs = useCallback(async (page: number): Promise<void> => {
    setLoading(true);
    try {
      const res = await vrfsApi.list({ page, page_size: PAGE_SIZE });
      setVrfs(res.data.items);
      setTotal(res.data.total);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Failed to load VRFs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchVrfs(currentPage);
  }, [fetchVrfs, currentPage]);

  const openCreate = useCallback((): void => {
    setEditingVrf(null);
    form.resetFields();
    form.setFieldValue('enforce_unique', true);
    setModalOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (vrf: VRF): void => {
      setEditingVrf(vrf);
      form.setFieldsValue({
        name: vrf.name,
        rd: vrf.rd ?? undefined,
        description: vrf.description ?? undefined,
        enforce_unique: vrf.enforce_unique,
      });
      setModalOpen(true);
    },
    [form]
  );

  const handleSubmit = useCallback(
    async (values: VRFCreate & VRFUpdate): Promise<void> => {
      setSubmitting(true);
      try {
        if (editingVrf) {
          await vrfsApi.update(editingVrf.id, {
            name: values.name,
            rd: values.rd,
            description: values.description,
            enforce_unique: values.enforce_unique,
          });
          message.success('VRF updated');
        } else {
          await vrfsApi.create({
            name: values.name!,
            rd: values.rd,
            description: values.description,
            enforce_unique: values.enforce_unique ?? true,
          });
          message.success('VRF created');
        }
        setModalOpen(false);
        form.resetFields();
        void fetchVrfs(currentPage);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Operation failed');
      } finally {
        setSubmitting(false);
      }
    },
    [editingVrf, currentPage, fetchVrfs, form]
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        await vrfsApi.delete(id);
        message.success('VRF deleted');
        void fetchVrfs(currentPage);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Delete failed');
      }
    },
    [currentPage, fetchVrfs]
  );

  const columns: ColumnsType<VRF> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: 'Route Distinguisher',
      dataIndex: 'rd',
      key: 'rd',
      render: (v: string | null) =>
        v ? <Typography.Text code>{v}</Typography.Text> : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Enforce Unique',
      dataIndex: 'enforce_unique',
      key: 'enforce_unique',
      width: 130,
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'}>{v ? 'Yes' : 'No'}</Tag>
      ),
    },
    {
      title: 'Subnets',
      dataIndex: 'subnet_count',
      key: 'subnet_count',
      width: 90,
      render: (v: number) => v,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (v: string | null) =>
        v ? (
          <Typography.Text type="secondary">{v}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    ...(hasRole('Operator')
      ? ([
          {
            title: 'Actions',
            key: 'actions',
            width: 100,
            render: (_: unknown, record: VRF) => (
              <Space size={4}>
                <Tooltip title="Edit">
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                </Tooltip>
                {hasRole('Administrator') && (
                  <Popconfirm
                    title="Delete this VRF?"
                    description="This will only succeed if no subnets are assigned."
                    onConfirm={() => void handleDelete(record.id)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                  >
                    <Tooltip title="Delete">
                      <Button size="small" icon={<DeleteOutlined />} danger />
                    </Tooltip>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ] as ColumnsType<VRF>)
      : []),
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          VRFs
        </Typography.Title>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void fetchVrfs(currentPage)}
            loading={loading}
          >
            Refresh
          </Button>
          {hasRole('Operator') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Create VRF
            </Button>
          )}
        </Space>
      </div>

      <Table<VRF>
        dataSource={vrfs}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 700 }}
        pagination={{
          current: currentPage,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (t) => `${t} VRFs`,
        }}
        onChange={(p: TablePaginationConfig) => setCurrentPage(p.current ?? 1)}
        size="small"
      />

      <Modal
        title={editingVrf ? 'Edit VRF' : 'Create VRF'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={editingVrf ? 'Save' : 'Create'}
        confirmLoading={submitting}
        width={480}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => void handleSubmit(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="Customer-A" />
          </Form.Item>

          <Form.Item label="Route Distinguisher" name="rd">
            <Input placeholder='65000:1' />
          </Form.Item>

          <Form.Item label="Enforce IP Uniqueness" name="enforce_unique" valuePropName="checked">
            <Switch defaultChecked />
          </Form.Item>

          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default VRFsPage;

import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Typography,
  Tag,
  Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { aggregatesApi } from '../../api/aggregates';
import { rirsApi } from '../../api/rirs';
import { useAuth } from '../../context/AuthContext';
import type { Aggregate, AggregateCreate, AggregateUpdate } from '../../types/aggregate';
import type { RIR } from '../../types/rir';

const PAGE_SIZE = 20;

const AggregatesPage: React.FC = () => {
  const { hasRole } = useAuth();
  const [aggregates, setAggregates] = useState<Aggregate[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [rirs, setRirs] = useState<RIR[]>([]);
  const [filterRir, setFilterRir] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgg, setEditingAgg] = useState<Aggregate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<AggregateCreate & AggregateUpdate>();

  const fetchRirs = useCallback(async (): Promise<void> => {
    try {
      const res = await rirsApi.list({ page_size: 100 });
      setRirs(res.data.items);
    } catch {
      // Non-critical
    }
  }, []);

  const fetchAggregates = useCallback(
    async (page: number): Promise<void> => {
      setLoading(true);
      try {
        const res = await aggregatesApi.list({
          page,
          page_size: PAGE_SIZE,
          rir_id: filterRir,
          search: search || undefined,
        });
        setAggregates(res.data.items);
        setTotal(res.data.total);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(
          axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Failed to load aggregates'
        );
      } finally {
        setLoading(false);
      }
    },
    [filterRir, search]
  );

  useEffect(() => {
    void fetchRirs();
  }, [fetchRirs]);

  useEffect(() => {
    void fetchAggregates(currentPage);
  }, [fetchAggregates, currentPage]);

  const openCreate = useCallback((): void => {
    setEditingAgg(null);
    form.resetFields();
    setModalOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (agg: Aggregate): void => {
      setEditingAgg(agg);
      form.setFieldsValue({
        rir_id: agg.rir_id,
        description: agg.description ?? undefined,
        date_added: agg.date_added ?? undefined,
      });
      setModalOpen(true);
    },
    [form]
  );

  const handleSubmit = useCallback(
    async (values: AggregateCreate & AggregateUpdate): Promise<void> => {
      setSubmitting(true);
      try {
        if (editingAgg) {
          await aggregatesApi.update(editingAgg.id, {
            rir_id: values.rir_id,
            description: values.description,
            date_added: values.date_added,
          });
          message.success('Aggregate updated');
        } else {
          await aggregatesApi.create({
            prefix: values.prefix!,
            rir_id: values.rir_id!,
            description: values.description,
            date_added: values.date_added,
          });
          message.success('Aggregate created');
        }
        setModalOpen(false);
        form.resetFields();
        void fetchAggregates(currentPage);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Operation failed');
      } finally {
        setSubmitting(false);
      }
    },
    [editingAgg, currentPage, fetchAggregates, form]
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        await aggregatesApi.delete(id);
        message.success('Aggregate deleted');
        void fetchAggregates(currentPage);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Delete failed');
      }
    },
    [currentPage, fetchAggregates]
  );

  const columns: ColumnsType<Aggregate> = [
    {
      title: 'Prefix',
      dataIndex: 'prefix',
      key: 'prefix',
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: 'RIR',
      dataIndex: 'rir_name',
      key: 'rir_name',
      width: 120,
      render: (v: string, record: Aggregate) => {
        const rir = rirs.find((r) => r.id === record.rir_id);
        return (
          <Tag color={rir?.is_private ? 'default' : 'blue'}>{v || record.rir_id}</Tag>
        );
      },
    },
    {
      title: 'Date Added',
      dataIndex: 'date_added',
      key: 'date_added',
      width: 120,
      render: (v: string | null) =>
        v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Contained Prefixes',
      dataIndex: 'contained_prefix_count',
      key: 'contained_prefix_count',
      width: 150,
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
            render: (_: unknown, record: Aggregate) => (
              <Space size={4}>
                <Tooltip title="Edit">
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                </Tooltip>
                {hasRole('Administrator') && (
                  <Popconfirm
                    title="Delete this aggregate?"
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
        ] as ColumnsType<Aggregate>)
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
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          Aggregates
        </Typography.Title>
        <Space wrap>
          <Input.Search
            placeholder="Search prefix…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={() => void fetchAggregates(1)}
            style={{ width: 200 }}
            allowClear
          />
          <Select
            placeholder="All RIRs"
            allowClear
            style={{ width: 140 }}
            value={filterRir}
            onChange={(v) => setFilterRir(v)}
            options={rirs.map((r) => ({ value: r.id, label: r.name }))}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void fetchAggregates(currentPage)}
            loading={loading}
          >
            Refresh
          </Button>
          {hasRole('Operator') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Aggregate
            </Button>
          )}
        </Space>
      </div>

      <Table<Aggregate>
        dataSource={aggregates}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{
          current: currentPage,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (t) => `${t} aggregates`,
        }}
        onChange={(p: TablePaginationConfig) => setCurrentPage(p.current ?? 1)}
        size="small"
      />

      <Modal
        title={editingAgg ? 'Edit Aggregate' : 'Add Aggregate'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={editingAgg ? 'Save' : 'Create'}
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
          {!editingAgg && (
            <Form.Item
              label="Prefix"
              name="prefix"
              rules={[
                { required: true, message: 'Prefix is required' },
                {
                  pattern: /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
                  message: 'Enter a valid CIDR (e.g. 10.0.0.0/8)',
                },
              ]}
            >
              <Input placeholder="10.0.0.0/8" />
            </Form.Item>
          )}

          <Form.Item
            label="RIR"
            name="rir_id"
            rules={[{ required: true, message: 'RIR is required' }]}
          >
            <Select
              placeholder="Select RIR"
              options={rirs.map((r) => ({
                value: r.id,
                label: r.name + (r.is_private ? ' (Private)' : ''),
              }))}
            />
          </Form.Item>

          <Form.Item label="Date Added" name="date_added">
            <Input placeholder="2024-01-15" />
          </Form.Item>

          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AggregatesPage;

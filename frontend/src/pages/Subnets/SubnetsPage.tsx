import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Row,
  Col,
  message,
  Popconfirm,
  Typography,
  Progress,
  Tag,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { subnetsApi } from '../../api/subnets';
import { vrfsApi } from '../../api/vrfs';
import { useAuth } from '../../context/AuthContext';
import type { SubnetCreate, SubnetDetail, SubnetTreeNode, SubnetUpdate } from '../../types/subnet';
import type { Environment } from '../../types/ipRecord';
import type { VRF } from '../../types/vrf';
import SubnetDetailDrawer from './SubnetDetailDrawer';

const ENV_OPTIONS: Environment[] = ['Production', 'Test', 'Development'];

const ENV_COLOR: Record<Environment, string> = {
  Production: 'red',
  Test: 'orange',
  Development: 'cyan',
};

const SubnetsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const [tree, setTree] = useState<SubnetTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [vrfs, setVrfs] = useState<VRF[]>([]);
  const [filterVrf, setFilterVrf] = useState<string | undefined>(undefined);
  const [filterEnv, setFilterEnv] = useState<Environment | undefined>(undefined);

  const [drawerSubnet, setDrawerSubnet] = useState<SubnetDetail | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSubnet, setEditingSubnet] = useState<SubnetTreeNode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<SubnetCreate & SubnetUpdate>();

  const fetchTree = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const params: { vrf_id?: string; environment?: string } = {};
      if (filterVrf) params.vrf_id = filterVrf;
      if (filterEnv) params.environment = filterEnv;
      const res = await subnetsApi.tree(params);
      setTree(res.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Failed to load subnets');
    } finally {
      setLoading(false);
    }
  }, [filterVrf, filterEnv]);

  const fetchVrfs = useCallback(async (): Promise<void> => {
    try {
      const res = await vrfsApi.list({ page_size: 200 });
      setVrfs(res.data.items);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    void fetchVrfs();
  }, [fetchVrfs]);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  const openCreate = useCallback((): void => {
    setEditingSubnet(null);
    form.resetFields();
    setModalOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (subnet: SubnetTreeNode): void => {
      setEditingSubnet(subnet);
      form.setFieldsValue({
        cidr: subnet.cidr,
        name: subnet.name,
        description: subnet.description ?? undefined,
        gateway: subnet.gateway ?? undefined,
        vlan_id: subnet.vlan_id ?? undefined,
        environment: subnet.environment,
        vrf_id: subnet.vrf_id ?? undefined,
      });
      setModalOpen(true);
    },
    [form]
  );

  const handleSubmit = useCallback(
    async (values: SubnetCreate & SubnetUpdate): Promise<void> => {
      setSubmitting(true);
      try {
        if (editingSubnet) {
          const update: SubnetUpdate = {
            name: values.name,
            description: values.description,
            gateway: values.gateway,
            vlan_id: values.vlan_id,
            environment: values.environment,
            vrf_id: values.vrf_id,
          };
          await subnetsApi.update(editingSubnet.id, update);
          message.success('Subnet updated');
        } else {
          const create: SubnetCreate = {
            cidr: values.cidr!,
            name: values.name!,
            description: values.description,
            gateway: values.gateway,
            vlan_id: values.vlan_id,
            environment: values.environment!,
            vrf_id: values.vrf_id,
          };
          await subnetsApi.create(create);
          message.success('Subnet created');
        }
        setModalOpen(false);
        form.resetFields();
        void fetchTree();
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Operation failed');
      } finally {
        setSubmitting(false);
      }
    },
    [editingSubnet, fetchTree, form]
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        await subnetsApi.delete(id);
        message.success('Subnet deleted');
        void fetchTree();
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Delete failed');
      }
    },
    [fetchTree]
  );

  const columns: ColumnsType<SubnetTreeNode> = [
    {
      title: 'CIDR',
      dataIndex: 'cidr',
      key: 'cidr',
      width: 180,
      render: (v: string, record: SubnetTreeNode) => (
        <Typography.Text
          code
          style={{ cursor: 'pointer', color: '#1677ff' }}
          onClick={() => setDrawerSubnet(record)}
        >
          {v}
        </Typography.Text>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, record: SubnetTreeNode) =>
        record.description ? <Tooltip title={record.description}>{v}</Tooltip> : v,
    },
    {
      title: 'VRF',
      dataIndex: 'vrf_id',
      key: 'vrf_id',
      width: 120,
      render: (v: string | null) => {
        if (!v) return <Typography.Text type="secondary">Global</Typography.Text>;
        const vrf = vrfs.find((x) => x.id === v);
        return vrf ? <Tag>{vrf.name}</Tag> : <Tag>{v.slice(0, 8)}…</Tag>;
      },
    },
    {
      title: 'Environment',
      dataIndex: 'environment',
      key: 'environment',
      width: 120,
      render: (v: Environment) => <Tag color={ENV_COLOR[v]}>{v}</Tag>,
    },
    {
      title: 'VLAN',
      dataIndex: 'vlan_id',
      key: 'vlan_id',
      width: 72,
      render: (v: number | null) =>
        v != null ? v : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Gateway',
      dataIndex: 'gateway',
      key: 'gateway',
      width: 140,
      render: (v: string | null) =>
        v ? (
          <Typography.Text code>{v}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Utilization',
      key: 'utilization',
      width: 220,
      render: (_, record) => {
        const pct = record.utilization_pct;
        const strokeColor = pct >= 90 ? '#ff4d4f' : pct >= 70 ? '#faad14' : '#52c41a';
        const label = record.is_container
          ? `${record.used_ips.toLocaleString()} / ${record.total_ips.toLocaleString()} IPs allocated`
          : `${record.used_ips} / ${record.total_ips} in use`;
        return (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 2,
                fontSize: 12,
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {record.is_container ? (
                  <>
                    <RightOutlined style={{ fontSize: 9, marginRight: 2 }} />
                    {record.child_prefix_count} child prefix{record.child_prefix_count !== 1 ? 'es' : ''}
                  </>
                ) : (
                  label
                )}
              </Typography.Text>
              <Typography.Text style={{ color: strokeColor, fontSize: 11 }}>{pct}%</Typography.Text>
            </div>
            <Progress percent={pct} showInfo={false} strokeColor={strokeColor} size="small" />
          </div>
        );
      },
    },
    ...(hasRole('Operator')
      ? ([
          {
            title: 'Actions',
            key: 'actions',
            width: 100,
            render: (_: unknown, record: SubnetTreeNode) => (
              <Space size={4}>
                <Tooltip title="Edit">
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                </Tooltip>
                {hasRole('Administrator') && (
                  <Popconfirm
                    title="Delete this subnet?"
                    description={
                      record.is_container
                        ? 'This subnet has children — delete them first.'
                        : 'This will only succeed if no IP records are assigned.'
                    }
                    onConfirm={() => void handleDelete(record.id)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    disabled={record.is_container}
                  >
                    <Tooltip
                      title={record.is_container ? 'Delete children first' : 'Delete'}
                    >
                      <Button
                        size="small"
                        icon={<DeleteOutlined />}
                        danger
                        disabled={record.is_container}
                      />
                    </Tooltip>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ] as ColumnsType<SubnetTreeNode>)
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
          Subnets
        </Typography.Title>
        <Space wrap>
          <Select
            placeholder="All VRFs"
            allowClear
            style={{ width: 160 }}
            value={filterVrf}
            onChange={(v) => setFilterVrf(v)}
            options={[
              { value: '', label: 'Global (no VRF)' },
              ...vrfs.map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
          <Select
            placeholder="All Environments"
            allowClear
            style={{ width: 160 }}
            value={filterEnv}
            onChange={(v) => setFilterEnv(v as Environment | undefined)}
            options={ENV_OPTIONS.map((e) => ({ value: e, label: e }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void fetchTree()} loading={loading}>
            Refresh
          </Button>
          {hasRole('Operator') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Create Subnet
            </Button>
          )}
        </Space>
      </div>

      <Table<SubnetTreeNode>
        dataSource={tree}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1000 }}
        pagination={false}
        size="small"
        expandable={{ childrenColumnName: 'children', defaultExpandAllRows: false }}
      />

      {/* Subnet Detail Drawer */}
      <SubnetDetailDrawer
        subnet={drawerSubnet}
        onClose={() => setDrawerSubnet(null)}
      />

      {/* Create / Edit Modal */}
      <Modal
        title={editingSubnet ? 'Edit Subnet' : 'Create Subnet'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={editingSubnet ? 'Save' : 'Create'}
        confirmLoading={submitting}
        width={520}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => void handleSubmit(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="CIDR"
            name="cidr"
            rules={[
              { required: true, message: 'CIDR is required' },
              {
                pattern: /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
                message: 'Enter a valid CIDR (e.g. 192.168.1.0/24)',
              },
            ]}
          >
            <Input placeholder="192.168.1.0/24" disabled={!!editingSubnet} />
          </Form.Item>

          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="Office LAN" />
          </Form.Item>

          <Form.Item
            label="Environment"
            name="environment"
            rules={[{ required: true, message: 'Environment is required' }]}
          >
            <Select options={ENV_OPTIONS.map((e) => ({ value: e, label: e }))} />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="VRF" name="vrf_id">
                <Select
                  placeholder="Global (no VRF)"
                  allowClear
                  options={vrfs.map((v) => ({ value: v.id, label: v.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="VLAN ID" name="vlan_id">
                <InputNumber min={1} max={4094} style={{ width: '100%' }} placeholder="100" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Gateway" name="gateway">
                <Input placeholder="192.168.1.1" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SubnetsPage;

import React, { useEffect, useState, useCallback } from 'react';
import {
  Drawer,
  Descriptions,
  Progress,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Row,
  Col,
  message,
  Popconfirm,
  Tag,
  Typography,
  Divider,
  Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, BugOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { ipRangesApi } from '../../api/ipRanges';
import { useAuth } from '../../context/AuthContext';
import type { SubnetDetail } from '../../types/subnet';
import type { IPRange, IPRangeCreate, IPRangeUpdate, IPRangeStatus } from '../../types/ipRange';
import { ENV_COLOR } from '../../constants/environments';
import ConflictScanDrawer from './ConflictScanDrawer';

const STATUS_OPTIONS: IPRangeStatus[] = ['Active', 'Reserved', 'Deprecated'];
const STATUS_COLOR: Record<IPRangeStatus, string> = {
  Active: 'green',
  Reserved: 'orange',
  Deprecated: 'default',
};

interface Props {
  subnet: SubnetDetail | null;
  onClose: () => void;
}

const SubnetDetailDrawer: React.FC<Props> = ({ subnet, onClose }) => {
  const { hasRole } = useAuth();
  const [ranges, setRanges] = useState<IPRange[]>([]);
  const [rangesTotal, setRangesTotal] = useState(0);
  const [loadingRanges, setLoadingRanges] = useState(false);
  const [rangeModal, setRangeModal] = useState(false);
  const [editingRange, setEditingRange] = useState<IPRange | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [conflictDrawerOpen, setConflictDrawerOpen] = useState(false);
  const [form] = Form.useForm<IPRangeCreate & IPRangeUpdate>();

  const fetchRanges = useCallback(async (subnetId: string): Promise<void> => {
    setLoadingRanges(true);
    try {
      const res = await ipRangesApi.listBySubnet(subnetId, { page_size: 50 });
      setRanges(res.data.items);
      setRangesTotal(res.data.total);
    } catch {
      setRanges([]);
    } finally {
      setLoadingRanges(false);
    }
  }, []);

  useEffect(() => {
    if (subnet?.id) {
      void fetchRanges(subnet.id);
    } else {
      setRanges([]);
      setRangesTotal(0);
    }
  }, [subnet, fetchRanges]);

  const openCreateRange = useCallback((): void => {
    setEditingRange(null);
    form.resetFields();
    if (subnet) form.setFieldValue('subnet_id', subnet.id);
    setRangeModal(true);
  }, [form, subnet]);

  const openEditRange = useCallback(
    (r: IPRange): void => {
      setEditingRange(r);
      form.setFieldsValue({
        name: r.name,
        description: r.description ?? undefined,
        start_address: r.start_address,
        end_address: r.end_address,
        status: r.status as IPRangeStatus,
      });
      setRangeModal(true);
    },
    [form]
  );

  const handleSubmitRange = useCallback(
    async (values: IPRangeCreate & IPRangeUpdate): Promise<void> => {
      if (!subnet) return;
      setSubmitting(true);
      try {
        if (editingRange) {
          await ipRangesApi.update(editingRange.id, {
            name: values.name,
            description: values.description,
            start_address: values.start_address,
            end_address: values.end_address,
            status: values.status,
          });
          message.success('IP range updated');
        } else {
          await ipRangesApi.create({
            subnet_id: subnet.id,
            name: values.name!,
            description: values.description,
            start_address: values.start_address!,
            end_address: values.end_address!,
            status: values.status,
          });
          message.success('IP range created');
        }
        setRangeModal(false);
        form.resetFields();
        void fetchRanges(subnet.id);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Operation failed');
      } finally {
        setSubmitting(false);
      }
    },
    [editingRange, subnet, fetchRanges, form]
  );

  const handleDeleteRange = useCallback(
    async (id: string): Promise<void> => {
      try {
        await ipRangesApi.delete(id);
        message.success('IP range deleted');
        if (subnet) void fetchRanges(subnet.id);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Delete failed');
      }
    },
    [subnet, fetchRanges]
  );

  const rangeColumns: ColumnsType<IPRange> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Start',
      dataIndex: 'start_address',
      key: 'start_address',
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: 'End',
      dataIndex: 'end_address',
      key: 'end_address',
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: 'Size',
      dataIndex: 'size',
      key: 'size',
      width: 70,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: IPRangeStatus) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
    },
    ...(hasRole('Operator')
      ? ([
          {
            title: '',
            key: 'actions',
            width: 80,
            render: (_: unknown, record: IPRange) => (
              <Space size={4}>
                <Tooltip title="Edit">
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEditRange(record)} />
                </Tooltip>
                {hasRole('Administrator') && (
                  <Popconfirm
                    title="Delete this range?"
                    onConfirm={() => void handleDeleteRange(record.id)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                  >
                    <Button size="small" icon={<DeleteOutlined />} danger />
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ] as ColumnsType<IPRange>)
      : []),
  ];

  if (!subnet) return null;


  const totalIps = subnet.total_ips;
  const usedPct = totalIps > 0 ? parseFloat((subnet.used_ips / totalIps * 100).toFixed(1)) : 0;
  const strokeColor = usedPct >= 90 ? '#ff4d4f' : usedPct >= 70 ? '#faad14' : '#52c41a';

  return (
    <>
      <Drawer
        title={
          <Space>
            <Typography.Text code>{subnet.cidr}</Typography.Text>
            <Typography.Text>{subnet.name}</Typography.Text>
          </Space>
        }
        placement="right"
        width={680}
        open={!!subnet}
        onClose={onClose}
        extra={
          hasRole('Operator') && (
            <Tooltip title="Scan for DNS conflicts">
              <Button
                icon={<BugOutlined />}
                size="small"
                onClick={() => setConflictDrawerOpen(true)}
              >
                Scan Conflicts
              </Button>
            </Tooltip>
          )
        }
      >
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="CIDR">{subnet.cidr}</Descriptions.Item>
          <Descriptions.Item label="Prefix Length">/{subnet.prefix_len}</Descriptions.Item>
          <Descriptions.Item label="Name">{subnet.name}</Descriptions.Item>
          <Descriptions.Item label="Environment">
            <Tag color={ENV_COLOR[subnet.environment]}>
              {subnet.environment}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Gateway">{subnet.gateway ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="VLAN">{subnet.vlan_id ?? '—'}</Descriptions.Item>
          {subnet.description && (
            <Descriptions.Item label="Description" span={2}>
              {subnet.description}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Created by">{subnet.created_by}</Descriptions.Item>
          <Descriptions.Item label="Updated by">{subnet.updated_by}</Descriptions.Item>
        </Descriptions>

        <Divider orientation="left" style={{ marginTop: 20 }}>
          IP Utilization
        </Divider>
        <div style={{ marginBottom: 16 }}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}
          >
            <Space size={16}>
              <span>
                <Typography.Text type="secondary">In Use: </Typography.Text>
                <Typography.Text strong style={{ color: '#1677ff' }}>
                  {subnet.used_ips}
                </Typography.Text>
              </span>
              <span>
                <Typography.Text type="secondary">Reserved: </Typography.Text>
                <Typography.Text strong style={{ color: '#fa8c16' }}>
                  {subnet.reserved_ips}
                </Typography.Text>
              </span>
              <span>
                <Typography.Text type="secondary">Free: </Typography.Text>
                <Typography.Text strong style={{ color: '#52c41a' }}>
                  {subnet.free_ips}
                </Typography.Text>
              </span>
            </Space>
            <Typography.Text style={{ color: strokeColor }}>{usedPct}%</Typography.Text>
          </div>
          <Progress percent={usedPct} showInfo={false} strokeColor={strokeColor} />
        </div>

        <Divider orientation="left">
          <Space>
            IP Ranges
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ({rangesTotal})
            </Typography.Text>
          </Space>
        </Divider>

        {hasRole('Operator') && (
          <div style={{ marginBottom: 8 }}>
            <Button size="small" icon={<PlusOutlined />} onClick={openCreateRange}>
              Add Range
            </Button>
          </div>
        )}

        <Table<IPRange>
          dataSource={ranges}
          columns={rangeColumns}
          rowKey="id"
          loading={loadingRanges}
          size="small"
          pagination={false}
          locale={{ emptyText: 'No IP ranges defined' }}
        />

        <Divider />
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => {
            window.open(`/ip-records?subnet_id=${subnet.id}`, '_blank');
          }}
        >
          View all IP records in this subnet →
        </Button>
      </Drawer>

      {/* DNS Conflict Scan Drawer */}
      <ConflictScanDrawer
        subnetId={subnet.id}
        subnetCidr={subnet.cidr}
        open={conflictDrawerOpen}
        onClose={() => setConflictDrawerOpen(false)}
      />

      {/* IP Range Create/Edit Modal */}
      <Modal
        title={editingRange ? 'Edit IP Range' : 'Add IP Range'}
        open={rangeModal}
        onCancel={() => {
          setRangeModal(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={editingRange ? 'Save' : 'Create'}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => void handleSubmitRange(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="DHCP Pool" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label="Start Address"
                name="start_address"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="10.0.1.100" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="End Address"
                name="end_address"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="10.0.1.200" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Status" name="status" initialValue="Active">
            <Select options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
          </Form.Item>

          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default SubnetDetailDrawer;

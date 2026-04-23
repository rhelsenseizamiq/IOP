import React, { useEffect, useState, useCallback } from 'react';
import {
  Alert,
  Button,
  Col,
  Dropdown,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
  notification,
} from 'antd';
const { useWatch } = Form;
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HistoryOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UnlockOutlined,
  UploadOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { TableRowSelection } from 'antd/es/table/interface';
import { ipRecordsApi } from '../../api/ipRecords';
import type { BulkUpdateFields } from '../../api/ipRecords';
import { subnetsApi } from '../../api/subnets';
import ExportModal from './ExportModal';
import ImportModal from './ImportModal';
import IPRecordHistoryDrawer from './IPRecordHistoryDrawer';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/common/StatusBadge';
import OSIcon from '../../components/common/OSIcon';
import type {
  IPRecord,
  IPRecordCreate,
  IPRecordUpdate,
  IPStatus,
  OSType,
  Environment,
  IPRecordFilters,
} from '../../types/ipRecord';
import type { SubnetDetail, SubnetCreate } from '../../types/subnet';
import { ENV_OPTIONS, ENV_COLOR } from '../../constants/environments';

const OS_OPTIONS: OSType[] = ['AIX', 'Linux', 'Windows', 'macOS', 'OpenShift', 'Unknown'];
const STATUS_OPTIONS: IPStatus[] = ['Free', 'Reserved', 'In Use'];
const PAGE_SIZE = 20;

function isIPv6(ip: string): boolean {
  return ip.includes(':');
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

function isIPInCIDR(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  if (isIPv6(ip) || isIPv6(network)) {
    // For IPv6, rely on server-side validation; client-side just allow it
    return true;
  }
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

function suggestCIDR(ip: string): string {
  if (isIPv6(ip)) {
    const groups = ip.split(':');
    const prefix = groups.slice(0, 4).map((g) => g || '0').join(':');
    return `${prefix}::/64`;
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return `${ip}/24`;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

const IPRecordsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const [records, setRecords] = useState<IPRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [subnets, setSubnets] = useState<SubnetDetail[]>([]);
  const [filters, setFilters] = useState<IPRecordFilters>({});
  const [searchText, setSearchText] = useState('');

  // Create/edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<IPRecord | null>(null);

  // Import / export modal state
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // History drawer
  const [historyRecord, setHistoryRecord] = useState<IPRecord | null>(null);

  // Ping / availability check
  const [pingingId, setPingingId] = useState<string | null>(null);

  // Row selection + bulk actions
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkForm] = Form.useForm<BulkUpdateFields>();
  const [form] = Form.useForm<IPRecordCreate & IPRecordUpdate>();
  const watchedSubnetId = useWatch('subnet_id', form) as string | undefined;
  const watchedIP = useWatch('ip_address', form) as string | undefined;
  const selectedSubnet = subnets.find((s) => s.id === watchedSubnetId);

  // Quick create-subnet modal (triggered when IP doesn't fit any existing subnet)
  const [quickSubnetOpen, setQuickSubnetOpen] = useState(false);
  const [quickSubnetSubmitting, setQuickSubnetSubmitting] = useState(false);
  const [quickSubnetForm] = Form.useForm<SubnetCreate>();

  const ipOutsideSubnet =
    !!watchedIP && !!selectedSubnet && !isIPInCIDR(watchedIP, selectedSubnet.cidr);

  const fetchSubnets = useCallback(async (): Promise<void> => {
    try {
      const res = await subnetsApi.list({ page_size: 200 });
      setSubnets(res.data.items);
    } catch {
      // Non-critical; subnets used for filter dropdown
    }
  }, []);

  const fetchRecords = useCallback(
    async (page: number, activeFilters: IPRecordFilters): Promise<void> => {
      setLoading(true);
      try {
        const res = await ipRecordsApi.list({ ...activeFilters, page, page_size: PAGE_SIZE });
        setRecords(res.data.items);
        setTotal(res.data.total);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Failed to load IP records');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchSubnets();
  }, [fetchSubnets]);

  useEffect(() => {
    void fetchRecords(currentPage, filters);
  }, [fetchRecords, currentPage, filters]);

  const applySearch = useCallback((): void => {
    setFilters((prev) => ({ ...prev, search: searchText || undefined }));
    setCurrentPage(1);
  }, [searchText]);

  const handleFilterChange = useCallback(
    (field: keyof IPRecordFilters, value: string | undefined): void => {
      setFilters((prev) => ({ ...prev, [field]: value || undefined }));
      setCurrentPage(1);
    },
    []
  );

  const handleTableChange = useCallback((pagination: TablePaginationConfig): void => {
    setCurrentPage(pagination.current ?? 1);
  }, []);

  const openCreate = useCallback((): void => {
    setEditingRecord(null);
    form.resetFields();
    setModalOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (record: IPRecord): void => {
      setEditingRecord(record);
      form.setFieldsValue({
        ip_address: record.ip_address,
        hostname: record.hostname ?? undefined,
        os_type: record.os_type,
        subnet_id: record.subnet_id,
        status: record.status,
        environment: record.environment,
        owner: record.owner ?? undefined,
        description: record.description ?? undefined,
      });
      setModalOpen(true);
    },
    [form]
  );

  const openQuickSubnet = useCallback((): void => {
    const ip = form.getFieldValue('ip_address') as string | undefined;
    const env = form.getFieldValue('environment') as string | undefined;
    quickSubnetForm.setFieldsValue({
      cidr: ip ? suggestCIDR(ip) : '',
      name: '',
      environment: (env as SubnetCreate['environment']) ?? 'Production',
      ip_version: ip && isIPv6(ip) ? 6 : 4,
    });
    setQuickSubnetOpen(true);
  }, [form, quickSubnetForm]);

  const handleQuickCreateSubnet = useCallback(
    async (values: SubnetCreate): Promise<void> => {
      setQuickSubnetSubmitting(true);
      try {
        const res = await subnetsApi.create(values);
        await fetchSubnets();
        form.setFieldValue('subnet_id', res.data.id);
        setQuickSubnetOpen(false);
        quickSubnetForm.resetFields();
        message.success(`Subnet ${res.data.cidr} created and selected`);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Failed to create subnet');
      } finally {
        setQuickSubnetSubmitting(false);
      }
    },
    [form, quickSubnetForm, fetchSubnets]
  );

  const handleSubmit = useCallback(
    async (values: IPRecordCreate & IPRecordUpdate): Promise<void> => {
      setSubmitting(true);
      try {
        if (editingRecord) {
          const update: IPRecordUpdate = {
            hostname: values.hostname,
            os_type: values.os_type,
            status: values.status,
            environment: values.environment,
            owner: values.owner,
            description: values.description,
          };
          await ipRecordsApi.update(editingRecord.id, update);
          message.success('IP record updated');
        } else {
          const create: IPRecordCreate = {
            ip_address: values.ip_address,
            hostname: values.hostname,
            os_type: values.os_type,
            subnet_id: values.subnet_id,
            status: values.status,
            environment: values.environment,
            owner: values.owner,
            description: values.description,
          };
          await ipRecordsApi.create(create);
          message.success('IP record created');
        }
        setModalOpen(false);
        form.resetFields();
        void fetchRecords(currentPage, filters);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        const detail = axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Operation failed';
        if (typeof detail === 'string' && detail.toLowerCase().includes('not within')) {
          // Backend rejected because IP doesn't fall inside the selected subnet
          openQuickSubnet();
        } else {
          message.error(detail);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [editingRecord, currentPage, filters, fetchRecords, form, openQuickSubnet]
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        await ipRecordsApi.delete(id);
        message.success('IP record deleted');
        void fetchRecords(currentPage, filters);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Delete failed');
      }
    },
    [currentPage, filters, fetchRecords]
  );

  const handleReserve = useCallback(
    async (id: string): Promise<void> => {
      try {
        await ipRecordsApi.reserve(id);
        message.success('IP reserved');
        void fetchRecords(currentPage, filters);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Reserve failed');
      }
    },
    [currentPage, filters, fetchRecords]
  );

  const handleRelease = useCallback(
    async (id: string): Promise<void> => {
      try {
        await ipRecordsApi.release(id);
        message.success('IP released');
        void fetchRecords(currentPage, filters);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Release failed');
      }
    },
    [currentPage, filters, fetchRecords]
  );

  const handlePing = useCallback(
    async (record: IPRecord): Promise<void> => {
      setPingingId(record.id);
      try {
        const res = await ipRecordsApi.ping(record.id, true);
        const { reachable, latency_ms, method, status_updated, new_status } = res.data;
        if (reachable) {
          notification.success({
            message: `${record.ip_address} is reachable`,
            description: status_updated
              ? `Status updated to ${new_status ?? 'In Use'} · Method: ${method}${latency_ms !== null ? ` · ${latency_ms} ms` : ''}`
              : `Method: ${method}${latency_ms !== null ? ` · ${latency_ms} ms` : ''}`,
            icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
            duration: 5,
          });
        } else {
          notification.warning({
            message: `${record.ip_address} did not respond`,
            description: status_updated
              ? `Status updated to ${new_status ?? 'Free'} — IP is available for use`
              : 'IP does not appear to be in use',
            icon: <CloseCircleOutlined style={{ color: '#faad14' }} />,
            duration: 6,
          });
        }
        if (status_updated) {
          void fetchRecords(currentPage, filters);
        }
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        void message.error(axiosErr.response?.data?.detail ?? 'Ping check failed');
      } finally {
        setPingingId(null);
      }
    },
    [currentPage, filters, fetchRecords]
  );

  const handleBulkReserve = useCallback(async (): Promise<void> => {
    const ids = selectedRowKeys as string[];
    try {
      await ipRecordsApi.bulkReserve(ids);
      message.success(`Reserved ${ids.length} records`);
      setSelectedRowKeys([]);
      void fetchRecords(currentPage, filters);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Bulk reserve failed');
    }
  }, [selectedRowKeys, currentPage, filters, fetchRecords]);

  const handleBulkRelease = useCallback(async (): Promise<void> => {
    const ids = selectedRowKeys as string[];
    try {
      await ipRecordsApi.bulkRelease(ids);
      message.success(`Released ${ids.length} records`);
      setSelectedRowKeys([]);
      void fetchRecords(currentPage, filters);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Bulk release failed');
    }
  }, [selectedRowKeys, currentPage, filters, fetchRecords]);

  const handleBulkUpdate = useCallback(
    async (values: BulkUpdateFields): Promise<void> => {
      const ids = selectedRowKeys as string[];
      setBulkSubmitting(true);
      try {
        const fields: BulkUpdateFields = {};
        if (values.environment) fields.environment = values.environment;
        if (values.owner !== undefined && values.owner !== '') fields.owner = values.owner;
        if (values.os_type) fields.os_type = values.os_type;
        await ipRecordsApi.bulkUpdate(ids, fields);
        message.success(`Updated ${ids.length} records`);
        setBulkModalOpen(false);
        bulkForm.resetFields();
        setSelectedRowKeys([]);
        void fetchRecords(currentPage, filters);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Bulk update failed');
      } finally {
        setBulkSubmitting(false);
      }
    },
    [selectedRowKeys, currentPage, filters, fetchRecords, bulkForm]
  );

  const rowSelection: TableRowSelection<IPRecord> = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  };

  const subnetMap = React.useMemo(
    () => new Map(subnets.map((s) => [s.id, s.cidr])),
    [subnets]
  );

  const columns: ColumnsType<IPRecord> = [
    {
      title: 'IP Address',
      dataIndex: 'ip_address',
      key: 'ip_address',
      width: 160,
      render: (v: string, record: IPRecord) => {
        const contextMenuItems: MenuProps['items'] = [
          {
            key: 'ping',
            label: pingingId === record.id ? (
              <Space><Spin size="small" /><span>Checking...</span></Space>
            ) : (
              <Space><WifiOutlined /><span>Check Availability</span></Space>
            ),
            disabled: pingingId === record.id,
            onClick: () => void handlePing(record),
          },
        ];
        return (
          <Dropdown menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
            <Tooltip title={record.description ? `${record.description} — right-click for more` : 'Right-click for options'}>
              <Typography.Text
                copyable
                code
                style={{ cursor: 'context-menu' }}
              >
                {v}
              </Typography.Text>
            </Tooltip>
          </Dropdown>
        );
      },
    },
    {
      title: 'Hostname',
      dataIndex: 'hostname',
      key: 'hostname',
      render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'OS',
      dataIndex: 'os_type',
      key: 'os_type',
      width: 110,
      render: (v: OSType) => <OSIcon osType={v} />,
    },
    {
      title: 'Subnet',
      dataIndex: 'subnet_id',
      key: 'subnet_id',
      width: 150,
      render: (id: string) => (
        <Typography.Text code>{subnetMap.get(id) ?? id}</Typography.Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v: IPStatus) => <StatusBadge status={v} />,
    },
    {
      title: 'Environment',
      dataIndex: 'environment',
      key: 'environment',
      width: 120,
      render: (v: Environment) => <Tag color={ENV_COLOR[v]}>{v}</Tag>,
    },
    {
      title: 'Owner',
      dataIndex: 'owner',
      key: 'owner',
      render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="History">
            <Button
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => setHistoryRecord(record)}
            />
          </Tooltip>
          {hasRole('Operator') && record.status === 'Free' && (
            <Tooltip title="Reserve">
              <Button
                size="small"
                icon={<LockOutlined />}
                onClick={() => void handleReserve(record.id)}
              />
            </Tooltip>
          )}
          {hasRole('Operator') && record.status === 'Reserved' && (
            <Tooltip title="Release">
              <Button
                size="small"
                icon={<UnlockOutlined />}
                onClick={() => void handleRelease(record.id)}
              />
            </Tooltip>
          )}
          {hasRole('Operator') && (
            <Tooltip title="Edit">
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEdit(record)}
              />
            </Tooltip>
          )}
          {hasRole('Administrator') && (
            <Popconfirm
              title="Delete this IP record?"
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
          IP Records
        </Typography.Title>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void fetchRecords(currentPage, filters)}
            loading={loading}
          >
            Refresh
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => setExportOpen(true)}>
            Export
          </Button>
          {hasRole('Operator') && (
            <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
              Import
            </Button>
          )}
          {hasRole('Operator') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add IP
            </Button>
          )}
        </Space>
      </div>

      {/* Filter bar */}
      <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8} md={6}>
          <Input.Search
            placeholder="Search IP / hostname / owner"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onSearch={applySearch}
            onPressEnter={applySearch}
            prefix={<SearchOutlined />}
            allowClear
            onClear={() => {
              setSearchText('');
              setFilters((prev) => ({ ...prev, search: undefined }));
              setCurrentPage(1);
            }}
          />
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Select
            placeholder="Status"
            allowClear
            style={{ width: '100%' }}
            onChange={(v) => handleFilterChange('status', v as string | undefined)}
          >
            {STATUS_OPTIONS.map((s) => (
              <Select.Option key={s} value={s}>
                {s}
              </Select.Option>
            ))}
          </Select>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Select
            placeholder="OS Type"
            allowClear
            style={{ width: '100%' }}
            onChange={(v) => handleFilterChange('os_type', v as string | undefined)}
          >
            {OS_OPTIONS.map((o) => (
              <Select.Option key={o} value={o}>
                {o}
              </Select.Option>
            ))}
          </Select>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Select
            placeholder="Environment"
            allowClear
            style={{ width: '100%' }}
            onChange={(v) => handleFilterChange('environment', v as string | undefined)}
          >
            {ENV_OPTIONS.map((e) => (
              <Select.Option key={e} value={e}>
                {e}
              </Select.Option>
            ))}
          </Select>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Select
            placeholder="Subnet"
            allowClear
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="children"
            onChange={(v) => handleFilterChange('subnet_id', v as string | undefined)}
          >
            {subnets.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                {s.cidr} — {s.name}
              </Select.Option>
            ))}
          </Select>
        </Col>
      </Row>

      {selectedRowKeys.length > 0 && hasRole('Operator') && (
        <Alert
          style={{ marginBottom: 8 }}
          message={
            <Space wrap>
              <Typography.Text strong>{selectedRowKeys.length} record(s) selected</Typography.Text>
              <Button size="small" icon={<LockOutlined />} onClick={() => void handleBulkReserve()}>
                Reserve
              </Button>
              <Button size="small" icon={<UnlockOutlined />} onClick={() => void handleBulkRelease()}>
                Release
              </Button>
              <Button size="small" icon={<EditOutlined />} onClick={() => setBulkModalOpen(true)}>
                Update Fields
              </Button>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>
                Clear
              </Button>
            </Space>
          }
          type="info"
          showIcon={false}
        />
      )}

      <Table<IPRecord>
        dataSource={records}
        columns={columns}
        rowKey="id"
        rowSelection={rowSelection}
        loading={loading}
        scroll={{ x: 1100 }}
        pagination={{
          current: currentPage,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (t) => `${t} records`,
        }}
        onChange={handleTableChange}
        size="small"
      />

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        subnets={subnets}
        currentFilters={filters}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void fetchRecords(currentPage, filters)}
      />

      <IPRecordHistoryDrawer
        record={historyRecord}
        onClose={() => setHistoryRecord(null)}
      />

      {/* Bulk Update Fields modal */}
      <Modal
        title="Update Fields for Selected Records"
        open={bulkModalOpen}
        onCancel={() => {
          setBulkModalOpen(false);
          bulkForm.resetFields();
        }}
        onOk={() => bulkForm.submit()}
        okText="Update"
        confirmLoading={bulkSubmitting}
        width={400}
        destroyOnClose
      >
        <Form
          form={bulkForm}
          layout="vertical"
          onFinish={(values) => void handleBulkUpdate(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item label="Environment" name="environment">
            <Select allowClear placeholder="(no change)">
              {ENV_OPTIONS.map((e) => (
                <Select.Option key={e} value={e}>{e}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="OS Type" name="os_type">
            <Select allowClear placeholder="(no change)">
              {OS_OPTIONS.map((o) => (
                <Select.Option key={o} value={o}>{o}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="Owner" name="owner">
            <Input placeholder="(no change)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create / Edit modal */}
      <Modal
        title={editingRecord ? 'Edit IP Record' : 'Add IP Record'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={editingRecord ? 'Save' : 'Create'}
        confirmLoading={submitting}
        width={560}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => void handleSubmit(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="IP Address"
            name="ip_address"
            extra={selectedSubnet && !ipOutsideSubnet ? `Must be within ${selectedSubnet.cidr}` : undefined}
            rules={[
              { required: true, message: 'IP address is required' },
              {
                validator(_rule, value: string) {
                  if (!value) return Promise.resolve();
                  const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
                  const ipv6Re = /^[0-9a-fA-F:]+$/;
                  if (ipv4Re.test(value) || ipv6Re.test(value)) return Promise.resolve();
                  return Promise.reject(new Error('Enter a valid IPv4 or IPv6 address'));
                },
              },
            ]}
          >
            <Input placeholder="e.g. 10.0.0.1" disabled={!!editingRecord} />
          </Form.Item>
          {ipOutsideSubnet && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`${watchedIP} is not within subnet ${selectedSubnet!.cidr}`}
              description="The IP falls outside the selected subnet. You can create a new subnet that covers this IP and continue."
              action={
                <Button
                  size="small"
                  icon={<ApartmentOutlined />}
                  onClick={openQuickSubnet}
                >
                  Create subnet for this IP
                </Button>
              }
            />
          )}

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Hostname" name="hostname">
                <Input placeholder="server01.example.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Owner" name="owner">
                <Input placeholder="team-name or username" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label="OS Type"
                name="os_type"
                rules={[{ required: true, message: 'OS type is required' }]}
              >
                <Select>
                  {OS_OPTIONS.map((o) => (
                    <Select.Option key={o} value={o}>
                      {o}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Environment"
                name="environment"
                rules={[{ required: true, message: 'Environment is required' }]}
              >
                <Select>
                  {ENV_OPTIONS.map((e) => (
                    <Select.Option key={e} value={e}>
                      {e}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {!editingRecord && (
            <Form.Item
              label="Subnet"
              name="subnet_id"
              rules={[{ required: true, message: 'Subnet is required' }]}
            >
              <Select
                showSearch
                optionFilterProp="children"
                placeholder="Select subnet"
              >
                {subnets.map((s) => (
                  <Select.Option key={s.id} value={s.id}>
                    {s.cidr} — {s.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}

          <Form.Item label="Status" name="status" initialValue="Free">
            <Select>
              {STATUS_OPTIONS.map((s) => (
                <Select.Option key={s} value={s}>
                  {s}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Quick Create Subnet modal */}
      <Modal
        title={
          <Space>
            <ApartmentOutlined />
            <span>Create Subnet for this IP</span>
          </Space>
        }
        open={quickSubnetOpen}
        onCancel={() => {
          setQuickSubnetOpen(false);
          quickSubnetForm.resetFields();
        }}
        onOk={() => quickSubnetForm.submit()}
        okText="Create & Select"
        confirmLoading={quickSubnetSubmitting}
        width={480}
        destroyOnClose
      >
        <Form
          form={quickSubnetForm}
          layout="vertical"
          onFinish={(values) => void handleQuickCreateSubnet(values as SubnetCreate)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="CIDR"
            name="cidr"
            rules={[{ required: true, message: 'CIDR is required' }]}
            extra="Auto-suggested from the IP address — adjust if needed"
          >
            <Input placeholder="e.g. 10.0.1.0/24" />
          </Form.Item>
          <Form.Item
            label="Subnet Name"
            name="name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="e.g. Server LAN" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Environment" name="environment" initialValue="Production">
                <Select>
                  {ENV_OPTIONS.map((e) => (
                    <Select.Option key={e} value={e}>{e}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="IP Version" name="ip_version" initialValue={4}>
                <Select>
                  <Select.Option value={4}>IPv4</Select.Option>
                  <Select.Option value={6}>IPv6</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Description" name="description">
            <Input placeholder="Optional description" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default IPRecordsPage;

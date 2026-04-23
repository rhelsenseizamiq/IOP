import React, { useState, useCallback } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DatabaseOutlined, ImportOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { integrationsApi } from '../../api/integrations';
import type {
  Device42DiscoverRequest,
  Device42IP,
  Device42ImportIP,
  Device42ImportResult,
} from '../../types/integrations';
import type { SubnetDetail } from '../../types/subnet';
import { ENV_OPTIONS } from '../../constants/environments';

interface Props {
  open: boolean;
  subnets: SubnetDetail[];
  onClose: () => void;
}

interface SelectionRow extends Device42IP {
  subnet_id?: string;
  environment?: string;
}

const STEP_CONNECT = 0;
const STEP_SELECT = 1;
const STEP_RESULTS = 2;

const Device42ImportDrawer: React.FC<Props> = ({ open, subnets, onClose }) => {
  const [step, setStep] = useState(STEP_CONNECT);
  const [connectLoading, setConnectLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [ips, setIps] = useState<SelectionRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [result, setResult] = useState<Device42ImportResult | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [form] = Form.useForm<Device42DiscoverRequest>();

  const handleConnect = useCallback(async (values: Device42DiscoverRequest): Promise<void> => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      const res = await integrationsApi.device42Discover(values);
      setIps(res.data.map((ip) => ({ ...ip, environment: 'Production' })));
      setSelectedKeys([]);
      setStep(STEP_SELECT);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setConnectError(detail ?? 'Failed to connect to Device42');
    } finally {
      setConnectLoading(false);
    }
  }, []);

  const handleImport = useCallback(async (): Promise<void> => {
    const toImport: Device42ImportIP[] = selectedKeys.flatMap((key) => {
      const row = ips.find((r) => r.ip_address === key);
      if (!row || !row.subnet_id) return [];
      return [{
        ip_address: row.ip_address,
        subnet_id: row.subnet_id,
        hostname: row.hostname ?? undefined,
        os_type: row.os_type,
        environment: row.environment ?? 'Production',
        device_name: row.device_name ?? undefined,
      }];
    });

    if (toImport.length === 0) {
      void message.warning('Select at least one IP with a subnet assigned');
      return;
    }

    setImportLoading(true);
    try {
      const res = await integrationsApi.device42Import(toImport);
      setResult(res.data);
      setStep(STEP_RESULTS);
    } catch {
      void message.error('Import failed');
    } finally {
      setImportLoading(false);
    }
  }, [selectedKeys, ips]);

  const handleClose = useCallback((): void => {
    setStep(STEP_CONNECT);
    setIps([]);
    setSelectedKeys([]);
    setResult(null);
    setConnectError(null);
    form.resetFields();
    onClose();
  }, [form, onClose]);

  const updateRow = useCallback((ip: string, field: keyof SelectionRow, value: string): void => {
    setIps((prev) => prev.map((r) => r.ip_address === ip ? { ...r, [field]: value } : r));
  }, []);

  const columns: ColumnsType<SelectionRow> = [
    {
      title: 'IP Address',
      dataIndex: 'ip_address',
      width: 140,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: 'Device / Hostname',
      dataIndex: 'device_name',
      ellipsis: true,
      render: (v: string | null, row) => v ?? row.hostname ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'OS',
      dataIndex: 'os_type',
      width: 100,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'D42 Subnet',
      dataIndex: 'subnet',
      ellipsis: true,
      render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Available',
      dataIndex: 'available',
      width: 90,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Yes' : 'No'}</Tag>,
    },
    {
      title: 'IPAM Subnet *',
      width: 200,
      render: (_: unknown, row: SelectionRow) => (
        <Select
          size="small"
          style={{ width: '100%' }}
          placeholder="Assign subnet"
          value={row.subnet_id}
          onChange={(val: string) => updateRow(row.ip_address, 'subnet_id', val)}
          showSearch
          optionFilterProp="label"
          options={subnets.map((s) => ({ value: s.id, label: `${s.cidr} — ${s.name}` }))}
        />
      ),
    },
    {
      title: 'Environment',
      width: 140,
      render: (_: unknown, row: SelectionRow) => (
        <Select
          size="small"
          style={{ width: '100%' }}
          value={row.environment ?? 'Production'}
          onChange={(val: string) => updateRow(row.ip_address, 'environment', val)}
          options={ENV_OPTIONS.map((e) => ({ value: e, label: e }))}
        />
      ),
    },
  ];

  return (
    <Drawer
      title={
        <Space>
          <DatabaseOutlined style={{ color: '#722ed1' }} />
          <span>Device42 Import</span>
        </Space>
      }
      width={900}
      open={open}
      onClose={handleClose}
      destroyOnClose
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: 'Connect' },
          { title: 'Select IPs' },
          { title: 'Results' },
        ]}
      />

      {step === STEP_CONNECT && (
        <Form
          form={form}
          layout="vertical"
          onFinish={handleConnect}
          initialValues={{ verify_ssl: false, limit: 2000 }}
        >
          {connectError && (
            <Alert type="error" message={connectError} style={{ marginBottom: 16 }} />
          )}
          <Form.Item label="Device42 Host" name="host" rules={[{ required: true }]}>
            <Input placeholder="device42.example.com" />
          </Form.Item>
          <Form.Item label="Username" name="username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item label="Max IPs to fetch" name="limit">
            <Input type="number" min={1} max={10000} />
          </Form.Item>
          <Form.Item name="verify_ssl" valuePropName="checked">
            <Checkbox>Verify SSL certificate</Checkbox>
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={connectLoading}
            icon={<DatabaseOutlined />}
          >
            Connect & Discover
          </Button>
        </Form>
      )}

      {step === STEP_SELECT && (
        <>
          <Alert
            type="info"
            message={`${ips.length} IPs discovered. Select IPs to import and assign each an IPAM subnet.`}
            style={{ marginBottom: 16 }}
          />
          {ips.length === 0 ? (
            <Empty description="No IPs found" />
          ) : (
            <Table
              size="small"
              dataSource={ips}
              rowKey="ip_address"
              columns={columns}
              scroll={{ x: 900 }}
              rowSelection={{
                selectedRowKeys: selectedKeys,
                onChange: (keys) => setSelectedKeys(keys as string[]),
              }}
              pagination={{ pageSize: 50 }}
            />
          )}
          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => setStep(STEP_CONNECT)}>Back</Button>
            <Button
              type="primary"
              icon={<ImportOutlined />}
              loading={importLoading}
              disabled={selectedKeys.length === 0}
              onClick={() => void handleImport()}
            >
              Import {selectedKeys.length > 0 ? `(${selectedKeys.length})` : ''}
            </Button>
          </Space>
        </>
      )}

      {step === STEP_RESULTS && result && (
        <>
          <Alert
            type={result.errors.length > 0 ? 'warning' : 'success'}
            message={`Import complete: ${result.created} created, ${result.skipped} skipped`}
            style={{ marginBottom: 16 }}
          />
          {result.errors.length > 0 && (
            <Alert
              type="error"
              message="Errors"
              description={
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              }
              style={{ marginBottom: 16 }}
            />
          )}
          <Button type="primary" onClick={handleClose}>Done</Button>
        </>
      )}
    </Drawer>
  );
};

export default Device42ImportDrawer;

import React, { useState, useCallback, useMemo } from 'react';
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
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { FireOutlined, ImportOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { integrationsApi } from '../../api/integrations';
import type {
  PaloAltoDiscoverRequest,
  PaloAltoDiscoverResult,
  PaloAltoImportAddress,
  PaloAltoImportResult,
} from '../../types/integrations';
import type { SubnetDetail } from '../../types/subnet';
import { ENV_OPTIONS } from '../../constants/environments';

interface Props {
  open: boolean;
  subnets: SubnetDetail[];
  onClose: () => void;
}

interface SelectionRow {
  key: string;
  ip_address: string;
  name: string;
  description: string | null;
  source: 'address' | 'interface' | 'arp';
  subnet_id?: string;
  environment?: string;
}

const STEP_CONNECT = 0;
const STEP_SELECT = 1;
const STEP_RESULTS = 2;

function extractIpFromNetmask(ipNetmask: string | null): string | null {
  if (!ipNetmask) return null;
  const ip = ipNetmask.split('/')[0];
  return ip || null;
}

const PaloAltoImportDrawer: React.FC<Props> = ({ open, subnets, onClose }) => {
  const [step, setStep] = useState(STEP_CONNECT);
  const [connectLoading, setConnectLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<PaloAltoDiscoverResult | null>(null);
  const [rows, setRows] = useState<SelectionRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [result, setResult] = useState<PaloAltoImportResult | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [form] = Form.useForm<PaloAltoDiscoverRequest>();

  const buildRows = useCallback((res: PaloAltoDiscoverResult): SelectionRow[] => {
    const out: SelectionRow[] = [];
    const seen = new Set<string>();

    for (const addr of res.addresses) {
      const ip = extractIpFromNetmask(addr.ip_netmask);
      if (!ip || seen.has(ip)) continue;
      seen.add(ip);
      out.push({
        key: `addr-${ip}`,
        ip_address: ip,
        name: addr.name,
        description: addr.description,
        source: 'address',
        environment: 'Production',
      });
    }

    for (const iface of res.interfaces) {
      if (!iface.ip_address || seen.has(iface.ip_address)) continue;
      seen.add(iface.ip_address);
      out.push({
        key: `iface-${iface.ip_address}`,
        ip_address: iface.ip_address,
        name: iface.name,
        description: iface.zone ? `Zone: ${iface.zone}` : null,
        source: 'interface',
        environment: 'Production',
      });
    }

    for (const arp of res.arp_entries) {
      if (!arp.ip || seen.has(arp.ip)) continue;
      seen.add(arp.ip);
      out.push({
        key: `arp-${arp.ip}`,
        ip_address: arp.ip,
        name: arp.mac || arp.ip,
        description: `ARP via ${arp.interface}`,
        source: 'arp',
        environment: 'Production',
      });
    }
    return out;
  }, []);

  const handleConnect = useCallback(async (values: PaloAltoDiscoverRequest): Promise<void> => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      const res = await integrationsApi.paloaltoDiscover(values);
      setDiscoveryResult(res.data);
      setRows(buildRows(res.data));
      setSelectedKeys([]);
      setStep(STEP_SELECT);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setConnectError(detail ?? 'Failed to connect to PaloAlto');
    } finally {
      setConnectLoading(false);
    }
  }, [buildRows]);

  const handleImport = useCallback(async (): Promise<void> => {
    const toImport: PaloAltoImportAddress[] = selectedKeys.flatMap((key) => {
      const row = rows.find((r) => r.key === key);
      if (!row || !row.subnet_id) return [];
      return [{
        ip_address: row.ip_address,
        subnet_id: row.subnet_id,
        hostname: row.name,
        os_type: 'Unknown',
        environment: row.environment ?? 'Production',
        description: row.description ?? `Imported from PaloAlto (${row.source})`,
      }];
    });

    if (toImport.length === 0) {
      void message.warning('Select at least one IP with a subnet assigned');
      return;
    }

    setImportLoading(true);
    try {
      const res = await integrationsApi.paloaltoImport(toImport);
      setResult(res.data);
      setStep(STEP_RESULTS);
    } catch {
      void message.error('Import failed');
    } finally {
      setImportLoading(false);
    }
  }, [selectedKeys, rows]);

  const handleClose = useCallback((): void => {
    setStep(STEP_CONNECT);
    setDiscoveryResult(null);
    setRows([]);
    setSelectedKeys([]);
    setResult(null);
    setConnectError(null);
    form.resetFields();
    onClose();
  }, [form, onClose]);

  const updateRow = useCallback((key: string, field: keyof SelectionRow, value: string): void => {
    setRows((prev) => prev.map((r) => r.key === key ? { ...r, [field]: value } : r));
  }, []);

  const SOURCE_COLOR: Record<string, string> = {
    address: 'blue',
    interface: 'green',
    arp: 'orange',
  };

  const columns: ColumnsType<SelectionRow> = [
    {
      title: 'IP Address',
      dataIndex: 'ip_address',
      width: 140,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: 'Name / MAC',
      dataIndex: 'name',
      ellipsis: true,
    },
    {
      title: 'Source',
      dataIndex: 'source',
      width: 90,
      render: (v: string) => <Tag color={SOURCE_COLOR[v]}>{v}</Tag>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      ellipsis: true,
      render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
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
          onChange={(val: string) => updateRow(row.key, 'subnet_id', val)}
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
          onChange={(val: string) => updateRow(row.key, 'environment', val)}
          options={ENV_OPTIONS.map((e) => ({ value: e, label: e }))}
        />
      ),
    },
  ];

  const addressRows = useMemo(() => rows.filter((r) => r.source === 'address'), [rows]);
  const interfaceRows = useMemo(() => rows.filter((r) => r.source === 'interface'), [rows]);
  const arpRows = useMemo(() => rows.filter((r) => r.source === 'arp'), [rows]);

  return (
    <Drawer
      title={
        <Space>
          <FireOutlined style={{ color: '#f5222d' }} />
          <span>PaloAlto Import</span>
        </Space>
      }
      width={950}
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
          initialValues={{ verify_ssl: false }}
        >
          {connectError && (
            <Alert type="error" message={connectError} style={{ marginBottom: 16 }} />
          )}
          <Form.Item label="PaloAlto Host" name="host" rules={[{ required: true }]}>
            <Input placeholder="firewall.example.com" />
          </Form.Item>
          <Form.Item label="Username" name="username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="verify_ssl" valuePropName="checked">
            <Checkbox>Verify SSL certificate</Checkbox>
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={connectLoading}
            icon={<FireOutlined />}
          >
            Connect & Discover
          </Button>
        </Form>
      )}

      {step === STEP_SELECT && discoveryResult && (
        <>
          <Alert
            type="info"
            message={`Discovered: ${discoveryResult.addresses.length} address objects, ${discoveryResult.interfaces.length} interfaces, ${discoveryResult.arp_entries.length} ARP entries`}
            style={{ marginBottom: 16 }}
          />
          {rows.length === 0 ? (
            <Empty description="No IP addresses found" />
          ) : (
            <Tabs
              items={[
                {
                  key: 'all',
                  label: `All (${rows.length})`,
                  children: (
                    <Table
                      size="small"
                      dataSource={rows}
                      rowKey="key"
                      columns={columns}
                      scroll={{ x: 900 }}
                      rowSelection={{
                        selectedRowKeys: selectedKeys,
                        onChange: (keys) => setSelectedKeys(keys as string[]),
                      }}
                      pagination={{ pageSize: 50 }}
                    />
                  ),
                },
                {
                  key: 'address',
                  label: `Address Objects (${addressRows.length})`,
                  children: (
                    <Table
                      size="small"
                      dataSource={addressRows}
                      rowKey="key"
                      columns={columns}
                      scroll={{ x: 900 }}
                      rowSelection={{
                        selectedRowKeys: selectedKeys,
                        onChange: (keys) => setSelectedKeys(keys as string[]),
                      }}
                      pagination={{ pageSize: 50 }}
                    />
                  ),
                },
                {
                  key: 'interface',
                  label: `Interfaces (${interfaceRows.length})`,
                  children: (
                    <Table
                      size="small"
                      dataSource={interfaceRows}
                      rowKey="key"
                      columns={columns}
                      scroll={{ x: 900 }}
                      rowSelection={{
                        selectedRowKeys: selectedKeys,
                        onChange: (keys) => setSelectedKeys(keys as string[]),
                      }}
                      pagination={{ pageSize: 50 }}
                    />
                  ),
                },
                {
                  key: 'arp',
                  label: `ARP Table (${arpRows.length})`,
                  children: (
                    <Table
                      size="small"
                      dataSource={arpRows}
                      rowKey="key"
                      columns={columns}
                      scroll={{ x: 900 }}
                      rowSelection={{
                        selectedRowKeys: selectedKeys,
                        onChange: (keys) => setSelectedKeys(keys as string[]),
                      }}
                      pagination={{ pageSize: 50 }}
                    />
                  ),
                },
              ]}
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

export default PaloAltoImportDrawer;

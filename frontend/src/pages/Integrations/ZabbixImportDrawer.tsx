import React, { useState, useCallback } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { FireOutlined, ImportOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { integrationsApi } from '../../api/integrations';
import type { ZabbixHost, ZabbixImportIP, ZabbixImportResult } from '../../types/integrations';
import type { SubnetDetail } from '../../types/subnet';
import { ENV_OPTIONS } from '../../constants/environments';

interface Props {
  open: boolean;
  subnets: SubnetDetail[];
  onClose: () => void;
}

interface SelectionRow extends ZabbixHost {
  subnet_id?: string;
  environment?: string;
}

const STEP_CONNECT = 0;
const STEP_SELECT = 1;
const STEP_RESULTS = 2;

const ZabbixImportDrawer: React.FC<Props> = ({ open, subnets, onClose }) => {
  const [step, setStep] = useState(STEP_CONNECT);
  const [connectLoading, setConnectLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [hosts, setHosts] = useState<SelectionRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [result, setResult] = useState<ZabbixImportResult | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleConnect = useCallback(async (): Promise<void> => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      const res = await integrationsApi.zabbixDiscover({ limit: 2000 });
      setHosts(res.data.map((h) => ({ ...h, environment: 'Production' })));
      setSelectedKeys([]);
      setStep(STEP_SELECT);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setConnectError(detail ?? 'Failed to connect to Zabbix');
    } finally {
      setConnectLoading(false);
    }
  }, []);

  const handleImport = useCallback(async (): Promise<void> => {
    const toImport: ZabbixImportIP[] = selectedKeys.flatMap((key) => {
      const row = hosts.find((r) => r.ip_address === key);
      if (!row || !row.subnet_id) return [];
      return [
        {
          ip_address: row.ip_address,
          subnet_id: row.subnet_id,
          hostname: row.hostname ?? undefined,
          environment: row.environment ?? 'Production',
          device_name: row.device_name ?? undefined,
        },
      ];
    });

    if (toImport.length === 0) {
      void message.warning('Select at least one host with a subnet assigned');
      return;
    }

    setImportLoading(true);
    try {
      const res = await integrationsApi.zabbixImport(toImport);
      setResult(res.data);
      setStep(STEP_RESULTS);
    } catch {
      void message.error('Import failed');
    } finally {
      setImportLoading(false);
    }
  }, [selectedKeys, hosts]);

  const handleClose = useCallback((): void => {
    setStep(STEP_CONNECT);
    setHosts([]);
    setSelectedKeys([]);
    setResult(null);
    setConnectError(null);
    onClose();
  }, [onClose]);

  const updateRow = useCallback(
    (ip: string, field: keyof SelectionRow, value: string): void => {
      setHosts((prev) =>
        prev.map((r) => (r.ip_address === ip ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

  const columns: ColumnsType<SelectionRow> = [
    {
      title: 'IP Address',
      dataIndex: 'ip_address',
      width: 140,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: 'Host',
      dataIndex: 'device_name',
      ellipsis: true,
      render: (v: string | null, row) =>
        v ?? row.hostname ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Monitoring',
      dataIndex: 'zabbix_status',
      width: 110,
      render: (v: string) => (
        <Tag color={v === 'enabled' ? 'blue' : 'default'}>{v}</Tag>
      ),
    },
    {
      title: 'Available',
      dataIndex: 'available',
      width: 100,
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
          options={subnets.map((s) => ({
            value: s.id,
            label: `${s.cidr} — ${s.name}`,
          }))}
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
          <FireOutlined style={{ color: '#d4380d' }} />
          <span>Zabbix Import</span>
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
        items={[{ title: 'Connect' }, { title: 'Select Hosts' }, { title: 'Results' }]}
      />

      {step === STEP_CONNECT && (
        <>
          {connectError && (
            <Alert
              type="error"
              message={connectError}
              style={{ marginBottom: 16 }}
            />
          )}
          <Typography.Paragraph type="secondary">
            Zabbix is already configured server-side (<Typography.Text code>zabbix.abb-bank.az</Typography.Text>,
            API token). Click below to fetch all monitored hosts and their IP
            addresses.
          </Typography.Paragraph>
          <Button
            type="primary"
            loading={connectLoading}
            icon={<FireOutlined />}
            style={{ background: '#d4380d', borderColor: '#d4380d' }}
            onClick={() => void handleConnect()}
          >
            Connect & Discover
          </Button>
        </>
      )}

      {step === STEP_SELECT && (
        <>
          <Alert
            type="info"
            message={`${hosts.length} host IPs discovered from Zabbix. Select hosts to import and assign each an IPAM subnet.`}
            style={{ marginBottom: 16 }}
          />
          {hosts.length === 0 ? (
            <Empty description="No hosts found" />
          ) : (
            <Table
              size="small"
              dataSource={hosts}
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
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              }
              style={{ marginBottom: 16 }}
            />
          )}
          <Button type="primary" onClick={handleClose}>
            Done
          </Button>
        </>
      )}
    </Drawer>
  );
};

export default ZabbixImportDrawer;

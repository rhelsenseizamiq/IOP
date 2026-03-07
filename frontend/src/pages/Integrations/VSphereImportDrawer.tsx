import React, { useState, useCallback } from 'react';
import {
  Drawer,
  Form,
  Input,
  Button,
  Table,
  Space,
  Typography,
  Tag,
  Select,
  Alert,
  Steps,
  Checkbox,
  message,
  Empty,
} from 'antd';
import { CloudServerOutlined, ImportOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { integrationsApi } from '../../api/integrations';
import type {
  VsphereDiscoverRequest,
  VsphereVM,
  VsphereImportVM,
  VsphereImportResult,
} from '../../types/integrations';
import type { Subnet } from '../../types/subnet';
import { ENV_OPTIONS } from '../../constants/environments';

interface Props {
  open: boolean;
  subnets: Subnet[];
  onClose: () => void;
}

interface SelectionRow extends VsphereVM {
  selected_ip?: string;
  subnet_id?: string;
  environment?: string;
}

const STEP_CONNECT = 0;
const STEP_SELECT = 1;
const STEP_RESULTS = 2;

const VSphereImportDrawer: React.FC<Props> = ({ open, subnets, onClose }) => {
  const [step, setStep] = useState(STEP_CONNECT);
  const [connectLoading, setConnectLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [vms, setVms] = useState<SelectionRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [result, setResult] = useState<VsphereImportResult | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectForm] = Form.useForm<VsphereDiscoverRequest>();

  const handleConnect = useCallback(async (values: VsphereDiscoverRequest): Promise<void> => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      const res = await integrationsApi.vsphereDiscover(values);
      const rows: SelectionRow[] = res.data.map((vm) => ({
        ...vm,
        selected_ip: vm.ip_addresses[0]?.address ?? '',
        subnet_id: undefined,
        environment: 'Production',
      }));
      setVms(rows);
      setSelectedKeys([]);
      setStep(STEP_SELECT);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      setConnectError(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Connection failed');
    } finally {
      setConnectLoading(false);
    }
  }, []);

  const handleImport = useCallback(async (): Promise<void> => {
    const toImport = vms.filter((vm) => selectedKeys.includes(vm.name));
    const invalid = toImport.filter((vm) => !vm.selected_ip || !vm.subnet_id);
    if (invalid.length > 0) {
      message.error(`Please select an IP and subnet for all checked VMs (${invalid.map((v) => v.name).join(', ')})`);
      return;
    }

    const importVms: VsphereImportVM[] = toImport.map((vm) => ({
      vm_name: vm.name,
      ip_address: vm.selected_ip!,
      subnet_id: vm.subnet_id!,
      hostname: vm.guest_hostname ?? vm.name,
      os_type: vm.os_type,
      environment: vm.environment ?? 'Production',
    }));

    setImportLoading(true);
    try {
      const res = await integrationsApi.vsphereImport({ vms: importVms });
      setResult(res.data);
      setStep(STEP_RESULTS);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Import failed');
    } finally {
      setImportLoading(false);
    }
  }, [vms, selectedKeys]);

  const handleClose = (): void => {
    setStep(STEP_CONNECT);
    setVms([]);
    setSelectedKeys([]);
    setResult(null);
    setConnectError(null);
    connectForm.resetFields();
    onClose();
  };

  const updateRow = (vmName: string, field: keyof SelectionRow, value: string): void => {
    setVms((prev) =>
      prev.map((vm) => (vm.name === vmName ? { ...vm, [field]: value } : vm))
    );
  };

  const vmColumns: ColumnsType<SelectionRow> = [
    {
      title: '',
      key: 'check',
      width: 40,
      render: (_: unknown, record: SelectionRow) => (
        <Checkbox
          checked={selectedKeys.includes(record.name)}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedKeys((prev) => [...prev, record.name]);
            } else {
              setSelectedKeys((prev) => prev.filter((k) => k !== record.name));
            }
          }}
        />
      ),
    },
    {
      title: 'VM Name',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: 'OS',
      dataIndex: 'os_type',
      key: 'os_type',
      width: 90,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Power',
      dataIndex: 'power_state',
      key: 'power_state',
      width: 70,
      render: (v: string) => (
        <Tag color={v === 'on' ? 'green' : 'default'}>{v}</Tag>
      ),
    },
    {
      title: 'IP Address',
      key: 'selected_ip',
      width: 160,
      render: (_: unknown, record: SelectionRow) => (
        <Select
          size="small"
          style={{ width: 150 }}
          value={record.selected_ip}
          onChange={(v) => updateRow(record.name, 'selected_ip', v)}
          options={record.ip_addresses.map((ip) => ({
            value: ip.address,
            label: `${ip.address} (IPv${ip.version})`,
          }))}
          placeholder="Select IP"
        />
      ),
    },
    {
      title: 'Target Subnet',
      key: 'subnet_id',
      width: 200,
      render: (_: unknown, record: SelectionRow) => (
        <Select
          size="small"
          style={{ width: 190 }}
          value={record.subnet_id}
          onChange={(v) => updateRow(record.name, 'subnet_id', v)}
          options={subnets.map((s) => ({ value: s.id, label: `${s.cidr} — ${s.name}` }))}
          placeholder="Select subnet"
          showSearch
          filterOption={(input, opt) =>
            (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      ),
    },
    {
      title: 'Environment',
      key: 'environment',
      width: 130,
      render: (_: unknown, record: SelectionRow) => (
        <Select
          size="small"
          style={{ width: 120 }}
          value={record.environment ?? 'Production'}
          onChange={(v) => updateRow(record.name, 'environment', v)}
          options={ENV_OPTIONS.map((e) => ({ value: e, label: e }))}
        />
      ),
    },
  ];

  return (
    <Drawer
      title={
        <Space>
          <CloudServerOutlined />
          <span>vSphere VM Import</span>
        </Space>
      }
      placement="right"
      width={1000}
      open={open}
      onClose={handleClose}
    >
      <Steps
        current={step}
        items={[
          { title: 'Connect' },
          { title: 'Select VMs' },
          { title: 'Results' },
        ]}
        style={{ marginBottom: 24 }}
      />

      {/* Step 0: Connect */}
      {step === STEP_CONNECT && (
        <>
          {connectError && (
            <Alert type="error" message={connectError} showIcon style={{ marginBottom: 16 }} />
          )}
          <Form
            form={connectForm}
            layout="vertical"
            onFinish={(values) => void handleConnect(values)}
            style={{ maxWidth: 480 }}
          >
            <Form.Item
              label="vCenter Host"
              name="host"
              rules={[{ required: true, message: 'vCenter host is required' }]}
            >
              <Input placeholder="vcenter.example.com" />
            </Form.Item>
            <Form.Item
              label="Username"
              name="username"
              rules={[{ required: true, message: 'Username is required' }]}
            >
              <Input placeholder="administrator@vsphere.local" />
            </Form.Item>
            <Form.Item
              label="Password"
              name="password"
              rules={[{ required: true, message: 'Password is required' }]}
            >
              <Input.Password placeholder="Password" />
            </Form.Item>
            <Form.Item label="Datacenter (optional)" name="datacenter">
              <Input placeholder="Leave blank for all datacenters" />
            </Form.Item>
            <Form.Item name="verify_ssl" valuePropName="checked" initialValue={false}>
              <Checkbox>Verify SSL certificate</Checkbox>
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                icon={<CloudServerOutlined />}
                loading={connectLoading}
              >
                Connect & Discover
              </Button>
            </Form.Item>
          </Form>
        </>
      )}

      {/* Step 1: Select VMs */}
      {step === STEP_SELECT && (
        <>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text type="secondary">
              {vms.length} VM(s) discovered — {selectedKeys.length} selected
            </Typography.Text>
            <Space>
              <Button size="small" onClick={() => setSelectedKeys(vms.map((v) => v.name))}>
                Select All
              </Button>
              <Button size="small" onClick={() => setSelectedKeys([])}>
                Clear
              </Button>
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
          </div>
          {vms.length === 0 ? (
            <Empty description="No VMs returned from vCenter" />
          ) : (
            <Table<SelectionRow>
              dataSource={vms}
              columns={vmColumns}
              rowKey="name"
              size="small"
              scroll={{ x: 900 }}
              pagination={{ pageSize: 20 }}
            />
          )}
        </>
      )}

      {/* Step 2: Results */}
      {step === STEP_RESULTS && result && (
        <>
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Alert
              type={result.errors.length > 0 ? 'warning' : 'success'}
              message={`Import complete: ${result.created} created, ${result.skipped} skipped, ${result.errors.length} error(s)`}
              showIcon
            />
            {result.errors.length > 0 && (
              <div>
                <Typography.Text type="secondary">Errors:</Typography.Text>
                <ul style={{ marginTop: 8 }}>
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      <Typography.Text type="danger" style={{ fontSize: 12 }}>
                        {e}
                      </Typography.Text>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button onClick={handleClose}>Done</Button>
          </Space>
        </>
      )}
    </Drawer>
  );
};

export default VSphereImportDrawer;

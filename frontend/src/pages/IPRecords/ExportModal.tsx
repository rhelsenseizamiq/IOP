import React, { useState } from 'react';
import { Modal, Select, Button, Space, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { ipRecordsApi } from '../../api/ipRecords';
import type { IPRecordFilters, OSType, IPStatus } from '../../types/ipRecord';
import type { SubnetDetail } from '../../types/subnet';
import { ENV_OPTIONS } from '../../constants/environments';

const OS_OPTIONS: OSType[] = ['AIX', 'Linux', 'Windows', 'macOS', 'OpenShift', 'Unknown'];
const STATUS_OPTIONS: IPStatus[] = ['Free', 'Reserved', 'In Use'];

interface Props {
  open: boolean;
  onClose: () => void;
  subnets: SubnetDetail[];
  /** Active filters already applied in the parent table — pre-populate */
  currentFilters: IPRecordFilters;
}

const ExportModal: React.FC<Props> = ({ open, onClose, subnets, currentFilters }) => {
  const [filters, setFilters] = useState<IPRecordFilters>(currentFilters);
  const [loading, setLoading] = useState(false);

  const set = (field: keyof IPRecordFilters, value: string | undefined): void =>
    setFilters((prev) => ({ ...prev, [field]: value || undefined }));

  const handleExport = async (): Promise<void> => {
    setLoading(true);
    try {
      await ipRecordsApi.exportRecords(filters);
      message.success('Export downloaded');
      onClose();
    } catch {
      message.error('Export failed — please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Export IP Records to CSV"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={loading}
            onClick={() => void handleExport()}
          >
            Download CSV
          </Button>
        </Space>
      }
      width={480}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
        Apply filters to export a subset of records, or leave all blank to export everything.
      </Typography.Paragraph>

      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            OS Type
          </Typography.Text>
          <Select
            placeholder="All OS types"
            allowClear
            style={{ width: '100%' }}
            defaultValue={currentFilters.os_type}
            onChange={(v) => set('os_type', v as string | undefined)}
          >
            {OS_OPTIONS.map((o) => (
              <Select.Option key={o} value={o}>{o}</Select.Option>
            ))}
          </Select>
        </div>

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            Status
          </Typography.Text>
          <Select
            placeholder="All statuses"
            allowClear
            style={{ width: '100%' }}
            defaultValue={currentFilters.status}
            onChange={(v) => set('status', v as string | undefined)}
          >
            {STATUS_OPTIONS.map((s) => (
              <Select.Option key={s} value={s}>{s}</Select.Option>
            ))}
          </Select>
        </div>

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            Environment
          </Typography.Text>
          <Select
            placeholder="All environments"
            allowClear
            style={{ width: '100%' }}
            defaultValue={currentFilters.environment}
            onChange={(v) => set('environment', v as string | undefined)}
          >
            {ENV_OPTIONS.map((e) => (
              <Select.Option key={e} value={e}>{e}</Select.Option>
            ))}
          </Select>
        </div>

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            Subnet
          </Typography.Text>
          <Select
            placeholder="All subnets"
            allowClear
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="children"
            defaultValue={currentFilters.subnet_id}
            onChange={(v) => set('subnet_id', v as string | undefined)}
          >
            {subnets.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                {s.cidr} — {s.name}
              </Select.Option>
            ))}
          </Select>
        </div>
      </Space>
    </Modal>
  );
};

export default ExportModal;

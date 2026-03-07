import React, { useState } from 'react';
import {
  Drawer,
  Button,
  Table,
  Tag,
  Typography,
  Space,
  Alert,
  Spin,
  Empty,
} from 'antd';
import { BugOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { conflictsApi } from '../../api/conflicts';
import type { ConflictItem, ConflictReport, ConflictType } from '../../types/conflicts';

const CONFLICT_COLOR: Record<ConflictType, string> = {
  FORWARD_MISMATCH: 'orange',
  PTR_MISMATCH: 'gold',
  NO_FORWARD: 'red',
  DUPLICATE_HOSTNAME: 'volcano',
};

const CONFLICT_LABEL: Record<ConflictType, string> = {
  FORWARD_MISMATCH: 'Forward Mismatch',
  PTR_MISMATCH: 'PTR Mismatch',
  NO_FORWARD: 'No Forward Record',
  DUPLICATE_HOSTNAME: 'Duplicate Hostname',
};

interface Props {
  subnetId: string;
  subnetCidr: string;
  open: boolean;
  onClose: () => void;
}

const columns: ColumnsType<ConflictItem> = [
  {
    title: 'IP Address',
    dataIndex: 'ip_address',
    key: 'ip_address',
    width: 140,
    render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
  },
  {
    title: 'Hostname',
    dataIndex: 'hostname',
    key: 'hostname',
    render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
  },
  {
    title: 'Conflict Type',
    dataIndex: 'conflict_type',
    key: 'conflict_type',
    width: 180,
    render: (v: ConflictType) => (
      <Tag color={CONFLICT_COLOR[v]}>{CONFLICT_LABEL[v]}</Tag>
    ),
  },
  {
    title: 'Detail',
    dataIndex: 'detail',
    key: 'detail',
    render: (v: string) => (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {v}
      </Typography.Text>
    ),
  },
];

const ConflictScanDrawer: React.FC<Props> = ({ subnetId, subnetCidr, open, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ConflictReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await conflictsApi.scan(subnetId);
      setReport(res.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      setError(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Scan failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = (): void => {
    setReport(null);
    setError(null);
    onClose();
  };

  return (
    <Drawer
      title={
        <Space>
          <BugOutlined />
          <span>DNS Conflict Scan</span>
          <Typography.Text code style={{ fontSize: 12 }}>
            {subnetCidr}
          </Typography.Text>
        </Space>
      }
      placement="right"
      width={800}
      open={open}
      onClose={handleClose}
      extra={
        <Button
          type="primary"
          icon={<BugOutlined />}
          loading={loading}
          onClick={() => void runScan()}
        >
          {report ? 'Re-scan' : 'Run Scan'}
        </Button>
      }
    >
      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">Resolving hostnames…</Typography.Text>
          </div>
        </div>
      )}

      {error && !loading && (
        <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />
      )}

      {report && !loading && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Space size={24}>
              <Typography.Text>
                Checked: <strong>{report.total_checked}</strong> hostname(s)
              </Typography.Text>
              <Typography.Text>
                Conflicts:{' '}
                <strong style={{ color: report.conflicts.length > 0 ? '#ff4d4f' : '#52c41a' }}>
                  {report.conflicts.length}
                </strong>
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Scanned at {new Date(report.scanned_at).toLocaleString()}
              </Typography.Text>
            </Space>
          </div>

          {report.conflicts.length === 0 ? (
            <Empty description="No DNS conflicts detected" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table<ConflictItem>
              dataSource={report.conflicts}
              columns={columns}
              rowKey={(r) => `${r.ip_address}-${r.conflict_type}`}
              size="small"
              pagination={{ pageSize: 20 }}
            />
          )}
        </>
      )}

      {!report && !loading && !error && (
        <Empty
          description="Click 'Run Scan' to check this subnet for DNS conflicts"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </Drawer>
  );
};

export default ConflictScanDrawer;

import React, { useEffect, useState, useCallback } from 'react';
import {
  Drawer,
  Timeline,
  Tag,
  Typography,
  Spin,
  message,
  Empty,
  Tooltip,
} from 'antd';
import {
  PlusCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ipRecordsApi } from '../../api/ipRecords';
import type { AuditLog, AuditAction } from '../../types/auditLog';
import type { IPRecord } from '../../types/ipRecord';

dayjs.extend(relativeTime);

interface Props {
  record: IPRecord | null;
  onClose: () => void;
}

const ACTION_COLOR: Record<AuditAction, string> = {
  CREATE: 'green',
  UPDATE: 'blue',
  DELETE: 'red',
  RESERVE: 'orange',
  RELEASE: 'cyan',
  LOGIN: 'default',
  LOGOUT: 'default',
  LOGIN_FAILED: 'red',
  PASSWORD_RESET: 'purple',
};

const ACTION_ICON: Partial<Record<AuditAction, React.ReactNode>> = {
  CREATE: <PlusCircleOutlined />,
  UPDATE: <EditOutlined />,
  DELETE: <DeleteOutlined />,
  RESERVE: <LockOutlined />,
  RELEASE: <UnlockOutlined />,
};

function DiffSection({ before, after }: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  if (!before && !after) return null;

  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);

  const changed = [...keys].filter(
    (k) => JSON.stringify((before ?? {})[k]) !== JSON.stringify((after ?? {})[k])
  );

  if (changed.length === 0) return null;

  return (
    <div style={{ marginTop: 8, fontSize: 12 }}>
      {changed.map((key) => (
        <div key={key} style={{ marginBottom: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {key}:
          </Typography.Text>{' '}
          <Typography.Text delete type="danger" style={{ fontSize: 11 }}>
            {String((before ?? {})[key] ?? '—')}
          </Typography.Text>
          {' → '}
          <Typography.Text type="success" style={{ fontSize: 11 }}>
            {String((after ?? {})[key] ?? '—')}
          </Typography.Text>
        </div>
      ))}
    </div>
  );
}

const IPRecordHistoryDrawer: React.FC<Props> = ({ record, onClose }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    try {
      const res = await ipRecordsApi.getHistory(id);
      setLogs(res.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (record) {
      void fetchHistory(record.id);
    } else {
      setLogs([]);
    }
  }, [record, fetchHistory]);

  return (
    <Drawer
      title={
        <span>
          History —{' '}
          <Typography.Text code copyable>
            {record?.ip_address ?? ''}
          </Typography.Text>
        </span>
      }
      open={!!record}
      onClose={onClose}
      width={480}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : logs.length === 0 ? (
        <Empty description="No history found" />
      ) : (
        <Timeline
          items={logs.map((log) => ({
            color: ACTION_COLOR[log.action] ?? 'default',
            dot: ACTION_ICON[log.action],
            children: (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Tag color={ACTION_COLOR[log.action]}>{log.action}</Tag>
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    {log.username}
                  </Typography.Text>
                  <Tooltip title={dayjs(log.timestamp).format('YYYY-MM-DD HH:mm:ss')}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(log.timestamp).fromNow()}
                    </Typography.Text>
                  </Tooltip>
                </div>
                {log.detail && (
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                    {log.detail}
                  </Typography.Text>
                )}
                <DiffSection before={log.before} after={log.after} />
              </div>
            ),
          }))}
        />
      )}
    </Drawer>
  );
};

export default IPRecordHistoryDrawer;

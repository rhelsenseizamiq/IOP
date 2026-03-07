import React, { useEffect, useState, useCallback } from 'react';
import {
  Row,
  Col,
  Card,
  Statistic,
  Table,
  Typography,
  Spin,
  message,
  Alert,
  Timeline,
  Tag,
  Tooltip,
} from 'antd';
import {
  GlobalOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  ClusterOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as ReTooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { statsApi } from '../../api/stats';
import type { DashboardStats, SubnetCritical, ActivityItem } from '../../types/stats';

dayjs.extend(relativeTime);

// ── Color maps ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  Free: '#52c41a',
  Reserved: '#fa8c16',
  'In Use': '#1677ff',
};

const OS_COLOR: Record<string, string> = {
  Linux: '#52c41a',
  Windows: '#1677ff',
  AIX: '#722ed1',
  macOS: '#13c2c2',
  OpenShift: '#eb2f96',
  Unknown: '#8c8c8c',
};

// Antd tag colours are named, recharts needs hex equivalents
const ENV_HEX: Record<string, string> = {
  Production: '#ff4d4f',
  Staging: '#faad14',
  UAT: '#722ed1',
  QA: '#fa541c',
  Test: '#fa8c16',
  Development: '#13c2c2',
  DR: '#eb2f96',
  Lab: '#2f54eb',
};

const ACTION_COLOR: Record<string, string> = {
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

// ── Subnet alert columns ────────────────────────────────────────────────────────

const criticalColumns: ColumnsType<SubnetCritical> = [
  {
    title: 'CIDR',
    dataIndex: 'cidr',
    key: 'cidr',
    render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
  },
  {
    title: 'Name',
    dataIndex: 'name',
    key: 'name',
  },
  {
    title: 'Utilization',
    dataIndex: 'utilization_pct',
    key: 'utilization_pct',
    width: 100,
    align: 'right' as const,
    render: (v: number, row: SubnetCritical) => {
      const color = v >= 90 ? '#ff4d4f' : v >= 70 ? '#fa8c16' : '#52c41a';
      const overThreshold = row.alert_threshold !== null && v >= row.alert_threshold;
      return (
        <span style={{ color }}>
          {overThreshold && <WarningOutlined style={{ marginRight: 4 }} />}
          {v}%
        </span>
      );
    },
  },
];

// ── Main component ──────────────────────────────────────────────────────────────

const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await statsApi.get();
      setStats(res.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!stats) return null;

  // Alerting subnets (have a threshold and exceed it)
  const alertingSubnets = stats.critical_subnets.filter(
    (s) => s.alert_threshold !== null && s.utilization_pct >= s.alert_threshold
  );

  // Pie chart data for IP status
  const statusPieData = Object.entries(stats.status_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  // Bar chart data for environment
  const envBarData = Object.entries(stats.environment_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  // Bar chart data for OS
  const osBarData = Object.entries(stats.os_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Dashboard
      </Typography.Title>

      {/* Threshold alerts banner */}
      {alertingSubnets.length > 0 && (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
          message={`${alertingSubnets.length} subnet(s) are above their alert threshold`}
          description={alertingSubnets
            .map((s) => `${s.cidr} (${s.utilization_pct}% ≥ ${s.alert_threshold ?? 0}%)`)
            .join(' · ')}
        />
      )}

      {/* Row 1 — 6 stat cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="Total IPs"
              value={stats.total_ips}
              prefix={<GlobalOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="Free"
              value={stats.status_breakdown['Free'] ?? 0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="Reserved"
              value={stats.status_breakdown['Reserved'] ?? 0}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="In Use"
              value={stats.status_breakdown['In Use'] ?? 0}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="Subnets"
              value={stats.total_subnets}
              prefix={<ApartmentOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="VRFs"
              value={stats.total_vrfs}
              prefix={<ClusterOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Row 2 — Pie chart (status) + Bar chart (environment) */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={10}>
          <Card title="IP Status">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={statusPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusPieData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLOR[entry.name] ?? '#8c8c8c'} />
                  ))}
                </Pie>
                <ReTooltip formatter={(value, name) => [`${value} IPs`, name]} />
                <Legend
                  formatter={(value, entry) => {
                    const total = statusPieData.reduce((s, d) => s + d.value, 0);
                    const pct = total > 0 ? ((entry.payload as { value: number }).value / total * 100).toFixed(0) : 0;
                    return `${value} (${pct}%)`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="IPs by Environment" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={envBarData} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={82} tick={{ fontSize: 11 }} />
                <ReTooltip />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                  {envBarData.map((entry) => (
                    <Cell key={entry.name} fill={ENV_HEX[entry.name] ?? '#1677ff'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      {/* Row 3 — OS bar chart + Critical subnets table */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="IPs by OS Type">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={osBarData} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11 }} />
                <ReTooltip />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                  {osBarData.map((entry) => (
                    <Cell key={entry.name} fill={OS_COLOR[entry.name] ?? '#8c8c8c'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Top Subnets by Utilization">
            <Table<SubnetCritical>
              dataSource={stats.critical_subnets}
              columns={criticalColumns}
              rowKey="id"
              pagination={false}
              size="small"
              locale={{ emptyText: 'No subnets' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Row 4 — Recent activity */}
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card title="Recent Activity">
            {stats.recent_activity.length === 0 ? (
              <Typography.Text type="secondary">No recent activity</Typography.Text>
            ) : (
              <Timeline
                items={stats.recent_activity.map((item: ActivityItem) => ({
                  color: ACTION_COLOR[item.action] ?? 'default',
                  children: (
                    <div>
                      <Tag color={ACTION_COLOR[item.action]}>{item.action}</Tag>
                      <Typography.Text strong>{item.username}</Typography.Text>
                      <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        {item.resource_type}
                      </Typography.Text>
                      <Tooltip title={dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss')}>
                        <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                          {dayjs(item.timestamp).fromNow()}
                        </Typography.Text>
                      </Tooltip>
                      {item.summary && (
                        <Typography.Text
                          type="secondary"
                          style={{ display: 'block', fontSize: 12 }}
                        >
                          {item.summary}
                        </Typography.Text>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default DashboardPage;

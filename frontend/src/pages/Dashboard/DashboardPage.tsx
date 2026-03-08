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
  Progress,
} from 'antd';
import {
  GlobalOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  ClusterOutlined,
  WarningOutlined,
  DatabaseOutlined,
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

// ── Color maps ───────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function utilizationColor(pct: number): string {
  if (pct >= 90) return '#ff4d4f';
  if (pct >= 70) return '#fa8c16';
  if (pct >= 50) return '#faad14';
  return '#52c41a';
}

// ── Subnet table columns ─────────────────────────────────────────────────────

const criticalColumns: ColumnsType<SubnetCritical> = [
  {
    title: 'CIDR',
    dataIndex: 'cidr',
    key: 'cidr',
    width: 150,
    render: (v: string) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text>,
  },
  {
    title: 'Name',
    dataIndex: 'name',
    key: 'name',
    ellipsis: true,
  },
  {
    title: 'Utilization',
    dataIndex: 'utilization_pct',
    key: 'utilization_pct',
    width: 180,
    render: (v: number, row: SubnetCritical) => {
      const overThreshold = row.alert_threshold !== null && v >= row.alert_threshold;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {overThreshold && (
            <Tooltip title={`Exceeds threshold (${row.alert_threshold ?? 0}%)`}>
              <WarningOutlined style={{ color: '#ff4d4f', flexShrink: 0 }} />
            </Tooltip>
          )}
          <Progress
            percent={v}
            size="small"
            strokeColor={utilizationColor(v)}
            format={(p) => `${p}%`}
            style={{ flex: 1, margin: 0 }}
          />
        </div>
      );
    },
  },
];

// ── Main component ────────────────────────────────────────────────────────────

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

  // Alerting subnets
  const alertingSubnets = stats.critical_subnets.filter(
    (s) => s.alert_threshold !== null && s.utilization_pct >= s.alert_threshold
  );

  // IP status donut
  const statusPieData = Object.entries(stats.status_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  // Overall utilization
  const totalIPs = stats.total_ips;
  const inUse = stats.status_breakdown['In Use'] ?? 0;
  const overallUtilPct = totalIPs > 0 ? Math.round((inUse / totalIPs) * 100) : 0;

  // Environment bar data
  const envBarData = Object.entries(stats.environment_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  // OS bar data
  const osBarData = Object.entries(stats.os_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Dashboard
      </Typography.Title>

      {/* Threshold alert banner */}
      {alertingSubnets.length > 0 && (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
          message={`${alertingSubnets.length} subnet(s) exceeded their alert threshold`}
          description={alertingSubnets
            .map((s) => `${s.cidr} (${s.utilization_pct}% ≥ ${s.alert_threshold ?? 0}%)`)
            .join(' · ')}
        />
      )}

      {/* Row 1 — IP status stat cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title="Total IPs"
              value={stats.total_ips}
              prefix={<GlobalOutlined />}
              valueStyle={{ color: '#1677ff', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title="Free"
              value={stats.status_breakdown['Free'] ?? 0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title="Reserved"
              value={stats.status_breakdown['Reserved'] ?? 0}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#fa8c16', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title="In Use"
              value={stats.status_breakdown['In Use'] ?? 0}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#1677ff', fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Row 2 — Infrastructure stat cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span><ApartmentOutlined style={{ marginRight: 4, color: '#1677ff' }} />IPv4 Subnets</span>}
              value={stats.subnet_v4_count}
              valueStyle={{ fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span><ApartmentOutlined style={{ marginRight: 4, color: '#722ed1' }} />IPv6 Subnets</span>}
              value={stats.subnet_v6_count}
              valueStyle={{ fontSize: 22, color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title="VRFs"
              value={stats.total_vrfs}
              prefix={<ClusterOutlined />}
              valueStyle={{ fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title="Aggregates"
              value={stats.total_aggregates}
              prefix={<DatabaseOutlined />}
              valueStyle={{ fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Row 3 — IP Status donut | IPv4/IPv6 donut | Overall utilization gauge */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {/* IP Status donut */}
        <Col xs={24} sm={24} lg={8}>
          <Card title="IP Status" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie
                  data={statusPieData}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={82}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusPieData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLOR[entry.name] ?? '#8c8c8c'} />
                  ))}
                </Pie>
                <ReTooltip formatter={(value, name) => [`${value} IPs`, name]} />
                <Legend
                  iconSize={10}
                  formatter={(value, entry) => {
                    const total = statusPieData.reduce((s, d) => s + d.value, 0);
                    const pct = total > 0 ? (((entry.payload as { value: number }).value / total) * 100).toFixed(0) : 0;
                    return `${value} — ${pct}%`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>

        {/* IPv4 / IPv6 breakdown */}
        <Col xs={24} sm={24} lg={8}>
          <Card title="IPv4 vs IPv6">
            <Row gutter={[8, 8]}>
              <Col span={12}>
                <div style={{ background: '#e6f4ff', borderRadius: 8, padding: '12px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1677ff', lineHeight: 1.2 }}>{stats.subnet_v4_count}</div>
                  <div style={{ fontSize: 11, color: '#1677ff', marginTop: 2 }}>IPv4 Subnets</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ background: '#f9f0ff', borderRadius: 8, padding: '12px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#722ed1', lineHeight: 1.2 }}>{stats.subnet_v6_count}</div>
                  <div style={{ fontSize: 11, color: '#722ed1', marginTop: 2 }}>IPv6 Subnets</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ background: '#e6f4ff', borderRadius: 8, padding: '12px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1677ff', lineHeight: 1.2 }}>{stats.ip_v4_count}</div>
                  <div style={{ fontSize: 11, color: '#1677ff', marginTop: 2 }}>IPv4 Records</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ background: '#f9f0ff', borderRadius: 8, padding: '12px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#722ed1', lineHeight: 1.2 }}>{stats.ip_v6_count}</div>
                  <div style={{ fontSize: 11, color: '#722ed1', marginTop: 2 }}>IPv6 Records</div>
                </div>
              </Col>
            </Row>
            {/* Split bar */}
            {(stats.subnet_v4_count + stats.subnet_v6_count) > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', height: 8 }}>
                  <div style={{
                    width: `${(stats.subnet_v4_count / (stats.subnet_v4_count + stats.subnet_v6_count)) * 100}%`,
                    background: '#1677ff',
                  }} />
                  <div style={{ flex: 1, background: '#722ed1' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>IPv4</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>IPv6</Typography.Text>
                </div>
              </div>
            )}
          </Card>
        </Col>

        {/* Overall utilization gauge — antd Progress */}
        <Col xs={24} sm={24} lg={8}>
          <Card title="Overall IP Utilization">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8 }}>
              <Progress
                type="dashboard"
                percent={overallUtilPct}
                size={160}
                strokeColor={utilizationColor(overallUtilPct)}
                strokeWidth={10}
                format={(p) => (
                  <span>
                    <div style={{ fontSize: 26, fontWeight: 700, color: utilizationColor(overallUtilPct), lineHeight: 1.1 }}>{p}%</div>
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>In Use</div>
                  </span>
                )}
              />
              <Row gutter={8} style={{ width: '100%', marginTop: 12 }}>
                <Col span={8} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#52c41a' }}>{stats.status_breakdown['Free'] ?? 0}</div>
                  <div style={{ fontSize: 11, color: '#8c8c8c' }}>Free</div>
                </Col>
                <Col span={8} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#fa8c16' }}>{stats.status_breakdown['Reserved'] ?? 0}</div>
                  <div style={{ fontSize: 11, color: '#8c8c8c' }}>Reserved</div>
                </Col>
                <Col span={8} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#1677ff' }}>{inUse}</div>
                  <div style={{ fontSize: 11, color: '#8c8c8c' }}>In Use</div>
                </Col>
              </Row>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Row 4 — Environment + OS bar charts */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="IPs by Environment">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={envBarData} layout="vertical" margin={{ left: 8, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 11 }} />
                <ReTooltip formatter={(v) => [`${v} IPs`]} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11 }}>
                  {envBarData.map((entry) => (
                    <Cell key={entry.name} fill={ENV_HEX[entry.name] ?? '#1677ff'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="IPs by OS Type">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={osBarData} layout="vertical" margin={{ left: 8, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11 }} />
                <ReTooltip formatter={(v) => [`${v} IPs`]} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11 }}>
                  {osBarData.map((entry) => (
                    <Cell key={entry.name} fill={OS_COLOR[entry.name] ?? '#8c8c8c'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      {/* Row 5 — Subnet utilization table + Recent activity */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="Subnet Utilization">
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
        <Col xs={24} lg={10}>
          <Card title="Recent Activity">
            {stats.recent_activity.length === 0 ? (
              <Typography.Text type="secondary">No recent activity</Typography.Text>
            ) : (
              <Timeline
                items={stats.recent_activity.map((item: ActivityItem) => ({
                  color: ACTION_COLOR[item.action] ?? 'default',
                  children: (
                    <div>
                      <Tag color={ACTION_COLOR[item.action]} style={{ marginBottom: 2 }}>{item.action}</Tag>
                      <Typography.Text strong style={{ fontSize: 13 }}>{item.username}</Typography.Text>
                      <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                        {item.resource_type}
                      </Typography.Text>
                      <Tooltip title={dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss')}>
                        <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>
                          {dayjs(item.timestamp).fromNow()}
                        </Typography.Text>
                      </Tooltip>
                      {item.summary && (
                        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 1 }}>
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

import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  Badge,
} from "antd";
import {
  GlobalOutlined,
  ApartmentOutlined,
  WarningOutlined,
  UnorderedListOutlined,
  SyncOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  QuestionCircleFilled,
} from "@ant-design/icons";
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
} from "recharts";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { statsApi } from "../../api/stats";
import type {
  DashboardStats,
  SubnetCritical,
  ActivityItem,
  SyncSourceStatus,
} from "../../types/stats";

dayjs.extend(relativeTime);

// Nightly cron: Device42 @ 02:00 UTC, Zabbix @ 02:35 UTC. Flag as stale past
// 27h so a single missed/delayed run doesn't false-alarm before the next one.
const SYNC_STALE_HOURS = 27;
const SYNC_SOURCE_LABEL: Record<string, string> = {
  device42: "Device42",
  zabbix: "Zabbix",
};

// ── Minimal 3-colour palette ─────────────────────────────────────────────────
const ACCENT = "#63e2b7";
const WARN = "#e8a85f";
const ERR = "#e57373";
const DIM = "rgba(255,255,255,0.35)";
const CHART = [
  ACCENT,
  "rgba(99,226,183,0.55)",
  "rgba(99,226,183,0.3)",
  "rgba(255,255,255,0.15)",
];

const STATUS_PIE: Record<string, string> = {
  Free: ACCENT,
  Reserved: WARN,
  "In Use": "rgba(99,226,183,0.5)",
};

function utilColor(pct: number) {
  if (pct >= 90) return ERR;
  if (pct >= 70) return WARN;
  return ACCENT;
}

type SyncHealth = "ok" | "stale" | "error" | "never";

function syncHealth(s: SyncSourceStatus | undefined): SyncHealth {
  if (!s || !s.last_run_at) return "never";
  if (s.status === "error") return "error";
  const hoursAgo = dayjs().diff(dayjs(s.last_run_at), "hour");
  return hoursAgo > SYNC_STALE_HOURS ? "stale" : "ok";
}

const SYNC_HEALTH_META: Record<
  SyncHealth,
  { color: string; icon: React.ReactNode; label: string }
> = {
  ok: { color: ACCENT, icon: <CheckCircleFilled />, label: "Healthy" },
  stale: { color: WARN, icon: <WarningOutlined />, label: "Overdue" },
  error: { color: ERR, icon: <CloseCircleFilled />, label: "Failed" },
  never: { color: DIM, icon: <QuestionCircleFilled />, label: "Never run" },
};

// ── Subnet utilization table ──────────────────────────────────────────────────
const criticalColumns: ColumnsType<SubnetCritical> = [
  {
    title: "CIDR",
    dataIndex: "cidr",
    key: "cidr",
    width: 150,
    render: (v: string) => (
      <Typography.Text code style={{ fontSize: 12 }}>
        {v}
      </Typography.Text>
    ),
  },
  { title: "Name", dataIndex: "name", key: "name", ellipsis: true },
  {
    title: "Utilization",
    dataIndex: "utilization_pct",
    key: "util",
    width: 180,
    render: (v: number, row: SubnetCritical) => {
      const over = row.alert_threshold !== null && v >= row.alert_threshold;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {over && (
            <Tooltip title={`Exceeds threshold (${row.alert_threshold ?? 0}%)`}>
              <WarningOutlined style={{ color: ERR, flexShrink: 0 }} />
            </Tooltip>
          )}
          <Progress
            percent={v}
            size="small"
            strokeColor={utilColor(v)}
            format={(p) => `${p}%`}
            style={{ flex: 1, margin: 0 }}
          />
        </div>
      );
    },
  },
];

// ── Component ─────────────────────────────────────────────────────────────────
const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await statsApi.get();
      setStats(res.data);
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      message.error(
        e.response?.data?.detail ?? e.message ?? "Failed to load dashboard",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  if (loading)
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  if (!stats) return null;

  const alerting = stats.critical_subnets.filter(
    (s) => s.alert_threshold !== null && s.utilization_pct >= s.alert_threshold,
  );
  const piData = Object.entries(stats.status_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  const inUse = stats.status_breakdown["In Use"] ?? 0;
  const utilPct =
    stats.total_ips > 0 ? Math.round((inUse / stats.total_ips) * 100) : 0;
  const envData = Object.entries(stats.environment_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  const osData = Object.entries(stats.os_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  const v4total = stats.subnet_v4_count + stats.subnet_v6_count;

  const STAT_ROWS: {
    title: string;
    value: number;
    icon: React.ReactNode;
    onClick?: () => void;
    valueColor?: string;
  }[][] = [
    [
      { title: "Total IPs", value: stats.total_ips, icon: <GlobalOutlined /> },
      { title: "Free", value: stats.status_breakdown["Free"] ?? 0, icon: null },
      {
        title: "Reserved",
        value: stats.status_breakdown["Reserved"] ?? 0,
        icon: null,
      },
      { title: "In Use", value: inUse, icon: null },
    ],
    [
      {
        title: "IPv4 Subnets",
        value: stats.subnet_v4_count,
        icon: <ApartmentOutlined />,
      },
      {
        title: "IPv6 Subnets",
        value: stats.subnet_v6_count,
        icon: <ApartmentOutlined />,
      },
      {
        title: "Unused IP Addresses",
        value: stats.unused_ips_total,
        icon: <UnorderedListOutlined />,
        onClick: () => navigate("/unused-ips"),
      },
      {
        title: "Alerting Subnets",
        value: alerting.length,
        icon: <WarningOutlined />,
        valueColor: alerting.length > 0 ? ERR : undefined,
      },
    ],
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Dashboard
      </Typography.Title>

      {alerting.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${alerting.length} subnet(s) exceeded alert threshold`}
          description={alerting
            .map(
              (s) =>
                `${s.cidr} (${s.utilization_pct}% ≥ ${s.alert_threshold ?? 0}%)`,
            )
            .join(" · ")}
        />
      )}

      {/* Stat rows */}
      {STAT_ROWS.map((row, ri) => (
        <Row key={ri} gutter={[12, 12]} style={{ marginBottom: 12 }}>
          {row.map((s) => (
            <Col key={s.title} xs={12} sm={6}>
              <Card
                size="small"
                hoverable={!!s.onClick}
                onClick={s.onClick}
                styles={{ body: { padding: "12px 16px" } }}
              >
                <Statistic
                  title={s.title}
                  value={s.value}
                  prefix={s.icon}
                  valueStyle={{ fontSize: 22, color: s.valueColor }}
                />
              </Card>
            </Col>
          ))}
        </Row>
      ))}

      {/* Data Sync Health */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={24}>
          <Card
            size="small"
            title={
              <span>
                <SyncOutlined style={{ marginRight: 8 }} />
                Data Sync Health
              </span>
            }
          >
            <Row gutter={[16, 12]}>
              {["device42", "zabbix"].map((source) => {
                const s = stats.sync_status[source];
                const health = syncHealth(s);
                const meta = SYNC_HEALTH_META[health];
                const c = s?.counters ?? {};
                const summary = Object.entries(c)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
                  .join(" · ");
                return (
                  <Col key={source} xs={24} sm={12}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 8,
                        padding: "10px 14px",
                      }}
                    >
                      <span
                        style={{
                          color: meta.color,
                          fontSize: 18,
                          marginTop: 2,
                        }}
                      >
                        {meta.icon}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <Typography.Text strong>
                            {SYNC_SOURCE_LABEL[source] ?? source}
                          </Typography.Text>
                          <Badge color={meta.color} text={meta.label} />
                        </div>
                        <div style={{ fontSize: 12, color: DIM, marginTop: 2 }}>
                          {s?.last_run_at ? (
                            <Tooltip
                              title={dayjs(s.last_run_at).format(
                                "YYYY-MM-DD HH:mm:ss",
                              )}
                            >
                              Last synced {dayjs(s.last_run_at).fromNow()}
                              {s.duration_seconds != null &&
                                ` · took ${Math.round(s.duration_seconds)}s`}
                            </Tooltip>
                          ) : (
                            "No sync has run yet"
                          )}
                        </div>
                        {s?.status === "error" && s.error && (
                          <Typography.Text
                            type="danger"
                            style={{
                              fontSize: 11,
                              display: "block",
                              marginTop: 2,
                            }}
                          >
                            {s.error}
                          </Typography.Text>
                        )}
                        {summary && (
                          <Typography.Text
                            type="secondary"
                            style={{
                              fontSize: 11,
                              display: "block",
                              marginTop: 2,
                            }}
                          >
                            {summary}
                          </Typography.Text>
                        )}
                      </div>
                    </div>
                  </Col>
                );
              })}
            </Row>
          </Card>
        </Col>
      </Row>

      {/* Charts row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16, marginTop: 4 }}>
        {/* Donut */}
        <Col xs={24} lg={8}>
          <Card title="IP Status" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie
                  data={piData}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={82}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {piData.map((e) => (
                    <Cell key={e.name} fill={STATUS_PIE[e.name] ?? DIM} />
                  ))}
                </Pie>
                <ReTooltip formatter={(v, n) => [`${v} IPs`, n]} />
                <Legend
                  iconSize={10}
                  formatter={(value, entry) => {
                    const total = piData.reduce((s, d) => s + d.value, 0);
                    const pct =
                      total > 0
                        ? (
                            ((entry.payload as { value: number }).value /
                              total) *
                            100
                          ).toFixed(0)
                        : 0;
                    return `${value} — ${pct}%`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>

        {/* IPv4/IPv6 breakdown */}
        <Col xs={24} lg={8}>
          <Card title="IPv4 vs IPv6">
            <Row gutter={[8, 8]}>
              {[
                { label: "IPv4 Subnets", value: stats.subnet_v4_count },
                { label: "IPv6 Subnets", value: stats.subnet_v6_count },
                { label: "IPv4 Records", value: stats.ip_v4_count },
                { label: "IPv6 Records", value: stats.ip_v6_count },
              ].map((item) => (
                <Col key={item.label} span={12}>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: 8,
                      padding: "12px 8px",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}
                    >
                      {item.value}
                    </div>
                    <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>
                      {item.label}
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
            {v4total > 0 && (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    display: "flex",
                    borderRadius: 4,
                    overflow: "hidden",
                    height: 6,
                  }}
                >
                  <div
                    style={{
                      width: `${(stats.subnet_v4_count / v4total) * 100}%`,
                      background: ACCENT,
                    }}
                  />
                  <div
                    style={{ flex: 1, background: "rgba(255,255,255,0.12)" }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 4,
                  }}
                >
                  <Typography.Text style={{ fontSize: 11, color: DIM }}>
                    IPv4
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 11, color: DIM }}>
                    IPv6
                  </Typography.Text>
                </div>
              </div>
            )}
          </Card>
        </Col>

        {/* Utilization gauge */}
        <Col xs={24} lg={8}>
          <Card title="Overall IP Utilization">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                paddingTop: 8,
              }}
            >
              <Progress
                type="dashboard"
                percent={utilPct}
                size={160}
                strokeColor={utilColor(utilPct)}
                strokeWidth={10}
                format={(p) => (
                  <span>
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 700,
                        color: utilColor(utilPct),
                        lineHeight: 1.1,
                      }}
                    >
                      {p}%
                    </div>
                    <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>
                      In Use
                    </div>
                  </span>
                )}
              />
              <Row gutter={8} style={{ width: "100%", marginTop: 12 }}>
                {[
                  { label: "Free", value: stats.status_breakdown["Free"] ?? 0 },
                  {
                    label: "Reserved",
                    value: stats.status_breakdown["Reserved"] ?? 0,
                  },
                  { label: "In Use", value: inUse },
                ].map((s) => (
                  <Col key={s.label} span={8} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 11, color: DIM }}>{s.label}</div>
                  </Col>
                ))}
              </Row>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Bar charts */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="IPs by Environment">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={envData}
                layout="vertical"
                margin={{ left: 8, right: 40 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  horizontal={false}
                  stroke="rgba(255,255,255,0.06)"
                />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={88}
                  tick={{ fontSize: 11 }}
                />
                <ReTooltip formatter={(v) => [`${v} IPs`]} />
                <Bar
                  dataKey="value"
                  radius={[0, 4, 4, 0]}
                  label={{ position: "right", fontSize: 11 }}
                >
                  {envData.map((_e, i) => (
                    <Cell key={i} fill={CHART[i % CHART.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="IPs by OS Type">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={osData}
                layout="vertical"
                margin={{ left: 8, right: 40 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  horizontal={false}
                  stroke="rgba(255,255,255,0.06)"
                />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={72}
                  tick={{ fontSize: 11 }}
                />
                <ReTooltip formatter={(v) => [`${v} IPs`]} />
                <Bar
                  dataKey="value"
                  radius={[0, 4, 4, 0]}
                  label={{ position: "right", fontSize: 11 }}
                >
                  {osData.map((_e, i) => (
                    <Cell key={i} fill={CHART[i % CHART.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      {/* Table + Activity */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="Subnet Utilization">
            <Table<SubnetCritical>
              dataSource={stats.critical_subnets}
              columns={criticalColumns}
              rowKey="id"
              pagination={false}
              size="small"
              locale={{ emptyText: "No subnets" }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Recent Activity">
            {stats.recent_activity.length === 0 ? (
              <Typography.Text type="secondary">
                No recent activity
              </Typography.Text>
            ) : (
              <Timeline
                items={stats.recent_activity.map((item: ActivityItem) => ({
                  color:
                    item.action === "DELETE" || item.action === "LOGIN_FAILED"
                      ? ERR
                      : ACCENT,
                  children: (
                    <div>
                      <Tag style={{ marginBottom: 2 }}>{item.action}</Tag>
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        {item.username}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ marginLeft: 6, fontSize: 12 }}
                      >
                        {item.resource_type}
                      </Typography.Text>
                      <Tooltip
                        title={dayjs(item.timestamp).format(
                          "YYYY-MM-DD HH:mm:ss",
                        )}
                      >
                        <Typography.Text
                          type="secondary"
                          style={{ marginLeft: 6, fontSize: 11 }}
                        >
                          {dayjs(item.timestamp).fromNow()}
                        </Typography.Text>
                      </Tooltip>
                      {item.summary && (
                        <Typography.Text
                          type="secondary"
                          style={{
                            display: "block",
                            fontSize: 11,
                            marginTop: 1,
                          }}
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

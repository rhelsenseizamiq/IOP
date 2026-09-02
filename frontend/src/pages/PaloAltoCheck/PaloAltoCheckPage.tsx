import React, { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Input,
  Progress,
  Radio,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  notification,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  ScanOutlined,
  SearchOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { ipRecordsApi } from "../../api/ipRecords";
import { integrationsApi, paloaltoCheckStream } from "../../api/integrations";
import type {
  PaloAltoCheckLogEntry,
  PaloAltoCheckResult,
  PaloAltoTrafficLogEntry,
  PaloAltoTrafficLogResult,
} from "../../types/integrations";

dayjs.extend(relativeTime);

function isValidIPv4(ip: string): boolean {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every(
    (p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255,
  );
}

function isValidCIDR(cidr: string): boolean {
  const [ip, prefix] = cidr.trim().split("/");
  if (!ip || !prefix || !/^\d{1,2}$/.test(prefix)) return false;
  const p = Number(prefix);
  return isValidIPv4(ip) && p >= 0 && p <= 32;
}

function cidrHostCount(cidr: string): number {
  const prefix = Number(cidr.trim().split("/")[1]);
  if (!Number.isFinite(prefix)) return 0;
  return Math.max(0, 2 ** (32 - prefix) - 2);
}

const MAX_BULK_IPS = 254;

const NAT_ROLE_META: Record<string, { color: string; label: string }> = {
  "original-source": { color: "blue", label: "Original Source" },
  "original-destination": { color: "geekblue", label: "Original Destination" },
  "translated-source": { color: "purple", label: "Translated Source" },
  "translated-destination": {
    color: "magenta",
    label: "Translated Destination",
  },
};

const SEC_ROLE_META: Record<string, { color: string; label: string }> = {
  source: { color: "blue", label: "Source" },
  destination: { color: "geekblue", label: "Destination" },
};

async function runCrossCheck(
  ip: string,
  source: "zabbix" | "device42",
  setLoading: (v: boolean) => void,
): Promise<void> {
  setLoading(true);
  try {
    const res = await ipRecordsApi.checkIp(ip, source);
    const { reachable, device_name } = res.data;
    const sourceName = source === "zabbix" ? "Zabbix" : "Device42";
    if (reachable) {
      notification.success({
        message: `${ip} found in ${sourceName}`,
        description: `Device: ${device_name ?? "unknown"}`,
        icon: <CheckCircleOutlined style={{ color: "#52c41a" }} />,
        duration: 6,
      });
    } else {
      notification.warning({
        message: `No ${sourceName} record for ${ip}`,
        description:
          source === "zabbix"
            ? "Zabbix has no host on this address, or it's currently reporting down."
            : "Device42 has no device assigned to this address.",
        icon: <CloseCircleOutlined style={{ color: "#8c8c8c" }} />,
        duration: 6,
      });
    }
  } catch (err: unknown) {
    const axiosErr = err as {
      response?: { data?: { detail?: string } };
      message?: string;
    };
    notification.error({
      message: `Check failed for ${ip}`,
      description: axiosErr.response?.data?.detail ?? axiosErr.message,
    });
  } finally {
    setLoading(false);
  }
}

// ── Trace log, terminal-styled ──────────────────────────────────────────────

const TerminalLog: React.FC<{ log: string[]; live?: boolean }> = ({
  log,
  live,
}) => {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [log]);

  if (log.length === 0) return null;
  return (
    <Collapse
      size="small"
      defaultActiveKey={["log"]}
      style={{ marginBottom: 16 }}
      items={[
        {
          key: "log",
          label: (
            <Space>
              <CodeOutlined />
              <Typography.Text strong>Trace Log</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                — exactly what was checked, and why
              </Typography.Text>
              {live && (
                <Tag color="processing" style={{ marginLeft: 4 }}>
                  <Spin size="small" style={{ marginRight: 4 }} />
                  live
                </Tag>
              )}
            </Space>
          ),
          children: (
            <div
              ref={bodyRef}
              style={{
                background: "#0b0f14",
                color: "#8ce68c",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 12.5,
                lineHeight: 1.7,
                padding: "10px 14px",
                borderRadius: 4,
                maxHeight: 320,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {log.map((line, i) => {
                const isResult = line.startsWith("RESULT:");
                const isSkip = line.includes("skipped (matched only a broad");
                return (
                  <div
                    key={i}
                    style={{
                      color: isResult
                        ? "#ffd666"
                        : isSkip
                          ? "#e8a85f"
                          : undefined,
                      fontWeight: isResult ? 600 : 400,
                    }}
                  >
                    {isResult ? "$ " : "  "}
                    {line}
                  </div>
                );
              })}
            </div>
          ),
        },
      ]}
    />
  );
};

// ── Save to IP Records ──────────────────────────────────────────────────────

const SaveToRecordsButton: React.FC<{ ipAddress: string }> = ({
  ipAddress,
}) => {
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const res = await integrationsApi.paloaltoSaveToRecords(ipAddress);
      const { action, subnet_cidr, hostname, status: recStatus } = res.data;
      notification.success({
        message:
          action === "created"
            ? `${ipAddress} added to IP Records`
            : `${ipAddress} updated in IP Records`,
        description: `Subnet ${subnet_cidr} · Status ${recStatus}${hostname ? ` · Hostname ${hostname}` : ""}`,
        icon: <SaveOutlined style={{ color: "#52c41a" }} />,
        duration: 6,
      });
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      notification.error({
        message: `Could not save ${ipAddress}`,
        description: axiosErr.response?.data?.detail ?? axiosErr.message,
      });
    } finally {
      setSaving(false);
    }
  }, [ipAddress]);

  return (
    <Button
      icon={<SaveOutlined />}
      loading={saving}
      onClick={() => void handleSave()}
    >
      Save to IP Records
    </Button>
  );
};

// ── PaloAlto's own 30-day traffic log (real observed sessions) ─────────────

/** The `nlogs` cap can be exhausted entirely by a busy host's last few
 * seconds of traffic — this measures how wide a slice the returned,
 * newest-first entries actually cover, so the UI can say so plainly
 * instead of implying a full-window view. */
function formatTrafficSpan(entries: PaloAltoTrafficLogEntry[]): string | null {
  if (entries.length < 2) return null;
  const newest = dayjs(entries[0].time_generated.replace(/\//g, "-"));
  const oldest = dayjs(
    entries[entries.length - 1].time_generated.replace(/\//g, "-"),
  );
  const seconds = Math.abs(newest.diff(oldest, "second"));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

const trafficLogColumns: ColumnsType<PaloAltoTrafficLogEntry> = [
  {
    title: "Time",
    dataIndex: "time_generated",
    key: "time_generated",
    width: 150,
    render: (v: string) => (
      <Tooltip title={v}>{dayjs(v.replace(/\//g, "-")).fromNow()}</Tooltip>
    ),
  },
  {
    title: "Source",
    key: "src",
    width: 170,
    render: (_: unknown, row: PaloAltoTrafficLogEntry) => (
      <Typography.Text code>
        {row.src}
        {row.sport != null ? `:${row.sport}` : ""}
      </Typography.Text>
    ),
  },
  {
    title: "Destination",
    key: "dst",
    width: 170,
    render: (_: unknown, row: PaloAltoTrafficLogEntry) => (
      <Typography.Text code>
        {row.dst}
        {row.dport != null ? `:${row.dport}` : ""}
      </Typography.Text>
    ),
  },
  { title: "Proto", dataIndex: "proto", key: "proto", width: 70 },
  { title: "App", dataIndex: "app", key: "app", width: 120 },
  {
    title: "Action",
    dataIndex: "action",
    key: "action",
    width: 90,
    render: (v: string | null) =>
      v ? (
        <Tag color={v === "allow" ? "green" : v === "deny" ? "red" : "default"}>
          {v}
        </Tag>
      ) : (
        "—"
      ),
  },
  { title: "Rule", dataIndex: "rule", key: "rule", ellipsis: true },
  {
    title: "Bytes",
    dataIndex: "bytes",
    key: "bytes",
    width: 90,
    render: (v: number | null) => (v != null ? v.toLocaleString() : "—"),
  },
  { title: "Firewall", dataIndex: "host", key: "host", width: 150 },
];

const TrafficLogPanel: React.FC<{ ipAddress: string }> = ({ ipAddress }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PaloAltoTrafficLogResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await integrationsApi.paloaltoTrafficLogs(ipAddress, 30);
      setResult(res.data);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      setErrorMsg(
        axiosErr.response?.data?.detail ??
          axiosErr.message ??
          "Failed to load traffic log",
      );
    } finally {
      setLoading(false);
    }
  }, [ipAddress]);

  if (!result && !loading && !errorMsg) {
    return (
      <Button
        icon={<HistoryOutlined />}
        onClick={() => void load()}
        style={{ marginBottom: 16 }}
      >
        Show 30-day Traffic Log (from PaloAlto)
      </Button>
    );
  }

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <Space>
          <HistoryOutlined />
          <Typography.Text strong>
            Traffic Log — last {result?.days ?? 30} days
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            — real sessions from PAN-OS's own logs, not our check-history
          </Typography.Text>
        </Space>
      }
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      }
    >
      {loading && (
        <div style={{ padding: "16px 0", textAlign: "center" }}>
          <Spin />
          <Typography.Text style={{ marginLeft: 12 }} type="secondary">
            Querying PaloAlto's log database — this can take a few seconds…
          </Typography.Text>
        </div>
      )}
      {errorMsg && !loading && (
        <Alert
          type="error"
          showIcon
          message={errorMsg}
          style={{ marginBottom: 12 }}
        />
      )}
      {!loading && result && (
        <>
          {result.entries.length === 0 ? (
            <Empty
              description={`No traffic for ${ipAddress} in the last ${result.days} days`}
            />
          ) : (
            <Table<PaloAltoTrafficLogEntry>
              dataSource={result.entries}
              columns={trafficLogColumns}
              rowKey={(row, i) => `${row.host}-${row.time_generated}-${i}`}
              size="small"
              pagination={{ pageSize: 10, showTotal: (t) => `${t} sessions` }}
              scroll={{ x: 900 }}
            />
          )}
          {result.truncated && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {(() => {
                const span = formatTrafficSpan(result.entries);
                return span
                  ? `Showing the most recent ${result.entries.length} sessions, spanning just ${span} — not the full ${result.days}-day window. This address has more traffic than the log cap can hold.`
                  : `Showing the most recent ${result.entries.length} sessions — more exist in this window.`;
              })()}
            </Typography.Text>
          )}
          {result.errors.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message="Some firewalls could not be queried"
              description={
                <ul style={{ margin: "8px 0 0 0", paddingLeft: 16 }}>
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              }
            />
          )}
        </>
      )}
    </Card>
  );
};

// ── Shared result rendering (single-IP view, and each bulk-scan row) ───────────

const ResultDetail: React.FC<{ result: PaloAltoCheckResult }> = ({
  result,
}) => {
  const [crossChecking, setCrossChecking] = useState<
    "zabbix" | "device42" | null
  >(null);
  const hasAddressOrArp = result.matches.length > 0;
  const hasNat = result.nat_matches.length > 0;
  const hasSecurity = result.security_matches.length > 0;

  if (!result.found) {
    return (
      <>
        <Alert
          type="warning"
          showIcon
          message={`${result.ip_address} appears UNUSED — no PaloAlto address object, live ARP entry, NAT rule, or security policy reference found`}
          description="This doesn't guarantee the address is free — PaloAlto only sees what it's configured to see. Cross-check the other sources below."
          style={{ marginBottom: 16 }}
        />
        <TerminalLog log={result.log} />
        <Space>
          <Button
            icon={<DatabaseOutlined />}
            loading={crossChecking === "zabbix"}
            onClick={() =>
              void runCrossCheck(result.ip_address, "zabbix", (v) =>
                setCrossChecking(v ? "zabbix" : null),
              )
            }
          >
            Check in Zabbix
          </Button>
          <Button
            icon={<DatabaseOutlined />}
            loading={crossChecking === "device42"}
            onClick={() =>
              void runCrossCheck(result.ip_address, "device42", (v) =>
                setCrossChecking(v ? "device42" : null),
              )
            }
          >
            Check in Device42
          </Button>
        </Space>
        <div style={{ marginTop: 16 }}>
          <TrafficLogPanel ipAddress={result.ip_address} />
        </div>
        {result.errors.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message="Some firewalls could not be reached — results may be incomplete"
            description={
              <ul style={{ margin: "8px 0 0 0", paddingLeft: 16 }}>
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            }
          />
        )}
      </>
    );
  }

  return (
    <>
      <Alert
        type="success"
        showIcon
        message={`${result.ip_address} is IN USE — found on PaloAlto`}
        description={
          result.hostname ? (
            <span>
              Hostname (reverse DNS):{" "}
              <Typography.Text code>{result.hostname}</Typography.Text>
            </span>
          ) : undefined
        }
        style={{ marginBottom: 16 }}
      />

      <TerminalLog log={result.log} />

      <Space style={{ marginBottom: 16 }}>
        <SaveToRecordsButton ipAddress={result.ip_address} />
      </Space>

      <TrafficLogPanel ipAddress={result.ip_address} />

      {hasAddressOrArp && (
        <Space
          direction="vertical"
          size={12}
          style={{
            width: "100%",
            marginBottom: hasNat || hasSecurity ? 20 : 0,
          }}
        >
          {result.matches.map((m, idx) => (
            <Card
              key={`${m.host}-${idx}`}
              size="small"
              title={
                <Space>
                  <SafetyCertificateOutlined style={{ color: "#52c41a" }} />
                  <Typography.Text strong>{m.host}</Typography.Text>
                </Space>
              }
            >
              <Descriptions size="small" column={1} bordered>
                {m.address_name && (
                  <Descriptions.Item label="Address Object">
                    {m.address_name}
                  </Descriptions.Item>
                )}
                {m.ip_netmask && (
                  <Descriptions.Item label="IP / Netmask">
                    <Typography.Text code>{m.ip_netmask}</Typography.Text>
                  </Descriptions.Item>
                )}
                {m.description && (
                  <Descriptions.Item label="Description">
                    {m.description}
                  </Descriptions.Item>
                )}
                {m.tags.length > 0 && (
                  <Descriptions.Item label="Tags">
                    <Space size={4} wrap>
                      {m.tags.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </Space>
                  </Descriptions.Item>
                )}
                {m.mac && (
                  <Descriptions.Item label="MAC (live ARP)">
                    <Typography.Text code copyable>
                      {m.mac}
                    </Typography.Text>
                  </Descriptions.Item>
                )}
                {m.interface && (
                  <Descriptions.Item label="Interface">
                    {m.interface}
                  </Descriptions.Item>
                )}
                {m.zone && (
                  <Descriptions.Item label="Zone">
                    <Tag color="cyan">{m.zone}</Tag>
                  </Descriptions.Item>
                )}
                {m.arp_status && (
                  <Descriptions.Item label="ARP Status">
                    <Tag
                      color={m.arp_status.trim() === "c" ? "green" : "default"}
                    >
                      {m.arp_status.trim() || "unknown"}
                    </Tag>
                  </Descriptions.Item>
                )}
                {m.ttl && (
                  <Descriptions.Item label="ARP TTL (s)">
                    {m.ttl}
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>
          ))}
        </Space>
      )}

      {hasNat && (
        <>
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            <SwapOutlined style={{ marginRight: 6 }} />
            NAT Rules ({result.nat_matches.length})
          </Typography.Text>
          <Space
            direction="vertical"
            size={12}
            style={{ width: "100%", marginBottom: hasSecurity ? 20 : 0 }}
          >
            {result.nat_matches.map((n, idx) => (
              <Card
                key={`${n.host}-${n.rule_name}-${idx}`}
                size="small"
                title={
                  <Space wrap>
                    <SwapOutlined style={{ color: "#9254de" }} />
                    <Typography.Text strong>{n.rule_name}</Typography.Text>
                    <Typography.Text type="secondary">
                      on {n.host}
                    </Typography.Text>
                    {n.disabled && <Tag color="red">Disabled</Tag>}
                  </Space>
                }
                extra={
                  <Space size={4} wrap>
                    {n.roles.map((r) => (
                      <Tag key={r} color={NAT_ROLE_META[r]?.color ?? "default"}>
                        {NAT_ROLE_META[r]?.label ?? r}
                      </Tag>
                    ))}
                  </Space>
                }
              >
                <Descriptions size="small" column={1} bordered>
                  {n.from_zones.length > 0 && (
                    <Descriptions.Item label="From Zone(s)">
                      <Space size={4} wrap>
                        {n.from_zones.slice(0, 8).map((z) => (
                          <Tag key={z}>{z}</Tag>
                        ))}
                        {n.from_zones.length > 8 && (
                          <Tag>+{n.from_zones.length - 8} more</Tag>
                        )}
                      </Space>
                    </Descriptions.Item>
                  )}
                  {n.to_zones.length > 0 && (
                    <Descriptions.Item label="To Zone(s)">
                      <Space size={4} wrap>
                        {n.to_zones.map((z) => (
                          <Tag key={z}>{z}</Tag>
                        ))}
                      </Space>
                    </Descriptions.Item>
                  )}
                  <Descriptions.Item label="Original Source">
                    {n.original_source.join(", ") || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Original Destination">
                    {n.original_destination.join(", ") || "—"}
                  </Descriptions.Item>
                  {n.translated_source && (
                    <Descriptions.Item label="Translated Source">
                      <Typography.Text code>
                        {n.translated_source}
                      </Typography.Text>
                    </Descriptions.Item>
                  )}
                  {n.translated_destination && (
                    <Descriptions.Item label="Translated Destination">
                      <Typography.Text code>
                        {n.translated_destination}
                      </Typography.Text>
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </Card>
            ))}
          </Space>
        </>
      )}

      {hasSecurity && (
        <>
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            <SafetyCertificateOutlined style={{ marginRight: 6 }} />
            Security Policy Rules ({result.security_matches.length}
            {result.security_matches_total > result.security_matches.length
              ? ` of ${result.security_matches_total}`
              : ""}
            )
          </Typography.Text>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {result.security_matches.map((s, idx) => (
              <Card
                key={`${s.host}-${s.rule_name}-${idx}`}
                size="small"
                title={
                  <Space wrap>
                    <SafetyCertificateOutlined
                      style={{
                        color: s.action === "allow" ? "#52c41a" : "#f5222d",
                      }}
                    />
                    <Typography.Text strong>{s.rule_name}</Typography.Text>
                    <Typography.Text type="secondary">
                      on {s.host}
                    </Typography.Text>
                    {s.disabled && <Tag color="red">Disabled</Tag>}
                  </Space>
                }
                extra={
                  <Space size={4} wrap>
                    <Tag color={s.action === "allow" ? "green" : "red"}>
                      {s.action.toUpperCase()}
                    </Tag>
                    {s.roles.map((r) => (
                      <Tag key={r} color={SEC_ROLE_META[r]?.color ?? "default"}>
                        {SEC_ROLE_META[r]?.label ?? r}
                      </Tag>
                    ))}
                  </Space>
                }
              >
                <Descriptions size="small" column={1} bordered>
                  {s.from_zones.length > 0 && (
                    <Descriptions.Item label="From Zone(s)">
                      <Space size={4} wrap>
                        {s.from_zones.map((z) => (
                          <Tag key={z}>{z}</Tag>
                        ))}
                      </Space>
                    </Descriptions.Item>
                  )}
                  {s.to_zones.length > 0 && (
                    <Descriptions.Item label="To Zone(s)">
                      <Space size={4} wrap>
                        {s.to_zones.map((z) => (
                          <Tag key={z}>{z}</Tag>
                        ))}
                      </Space>
                    </Descriptions.Item>
                  )}
                  <Descriptions.Item label="Source">
                    {s.source.join(", ") || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Destination">
                    {s.destination.join(", ") || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Application(s)">
                    <Space size={4} wrap>
                      {s.applications.map((a) => (
                        <Tag key={a}>{a}</Tag>
                      ))}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="Service(s)">
                    <Space size={4} wrap>
                      {s.services.map((sv) => (
                        <Tag key={sv}>{sv}</Tag>
                      ))}
                    </Space>
                  </Descriptions.Item>
                  {s.tags.length > 0 && (
                    <Descriptions.Item label="Tags">
                      <Space size={4} wrap>
                        {s.tags.map((t) => (
                          <Tag key={t}>{t}</Tag>
                        ))}
                      </Space>
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </Card>
            ))}
          </Space>
        </>
      )}

      {result.errors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message="Some firewalls could not be reached — results may be incomplete"
          description={
            <ul style={{ margin: "8px 0 0 0", paddingLeft: 16 }}>
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          }
        />
      )}
    </>
  );
};

// ── Recent Checks (last 30 days, from PaloAlto Check history) ───────────────

const SOURCE_LABEL: Record<string, string> = {
  "check-ip": "Single IP",
  "check-subnet": "Bulk scan",
  "check-stream": "Single IP (live)",
  "check-availability": "Check Availability",
  "subnet-scan": "Subnet scan",
};

const RecentChecksPanel: React.FC = () => {
  const [entries, setEntries] = useState<PaloAltoCheckLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await integrationsApi.paloaltoCheckLogs({ limit: 30 });
      setEntries(res.data);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      setErrorMsg(
        axiosErr.response?.data?.detail ??
          axiosErr.message ??
          "Failed to load history",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<PaloAltoCheckLogEntry> = [
    {
      title: "IP Address",
      dataIndex: "ip_address",
      key: "ip_address",
      width: 150,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: "Status",
      key: "found",
      width: 110,
      render: (_: unknown, row: PaloAltoCheckLogEntry) =>
        row.found ? (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            In Use
          </Tag>
        ) : (
          <Tag color="default" icon={<CloseCircleOutlined />}>
            Unused
          </Tag>
        ),
    },
    {
      title: "Hostname",
      dataIndex: "hostname",
      key: "hostname",
      width: 170,
      render: (v: string | null) =>
        v ? (
          <Typography.Text code>{v}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Source",
      dataIndex: "source",
      key: "source",
      width: 140,
      render: (v: string) => <Tag>{SOURCE_LABEL[v] ?? v}</Tag>,
    },
    {
      title: "Checked By",
      dataIndex: "checked_by",
      key: "checked_by",
      width: 130,
    },
    {
      title: "When",
      dataIndex: "checked_at",
      key: "checked_at",
      width: 150,
      render: (v: string) => (
        <Tooltip title={dayjs(v).format("YYYY-MM-DD HH:mm:ss")}>
          {dayjs(v).fromNow()}
        </Tooltip>
      ),
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginTop: 24 }}
      title={
        <Space>
          <HistoryOutlined />
          <Typography.Text strong>Recent Checks</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            — last 30 days, from every PaloAlto Check source
          </Typography.Text>
        </Space>
      }
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      }
    >
      {errorMsg && (
        <Alert
          type="error"
          showIcon
          message={errorMsg}
          style={{ marginBottom: 12 }}
        />
      )}
      <Table<PaloAltoCheckLogEntry>
        dataSource={entries}
        columns={columns}
        rowKey={(row) => `${row.ip_address}-${row.checked_at}`}
        size="small"
        loading={loading}
        pagination={{ pageSize: 10, showTotal: (t) => `${t} checks` }}
        locale={{ emptyText: "No PaloAlto checks yet" }}
        expandable={{
          expandedRowRender: (row) => <TerminalLog log={row.log} />,
        }}
      />
    </Card>
  );
};

// ── Main page ───────────────────────────────────────────────────────────────

type CheckMode = "single" | "bulk";
type BulkInputMode = "cidr" | "list";

const PaloAltoCheckPage: React.FC = () => {
  const [mode, setMode] = useState<CheckMode>("single");

  // Single-IP mode
  const [checkInput, setCheckInput] = useState("");
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<PaloAltoCheckResult | null>(
    null,
  );
  const [checkErrorMsg, setCheckErrorMsg] = useState<string | null>(null);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkAbortRef = useRef<AbortController | null>(null);

  const runPaloAltoCheck = useCallback(async (ip: string): Promise<void> => {
    checkAbortRef.current?.abort();
    const controller = new AbortController();
    checkAbortRef.current = controller;

    setCheckLoading(true);
    setCheckErrorMsg(null);
    setCheckResult(null);
    setLiveLog([]);
    try {
      await paloaltoCheckStream(
        { ip_addresses: [ip] },
        {
          onLog: (_ip, line) => setLiveLog((prev) => [...prev, line]),
          onResult: (result) => setCheckResult(result),
          onError: (message) => setCheckErrorMsg(message),
        },
        controller.signal,
      );
    } catch (err: unknown) {
      if (controller.signal.aborted) return; // superseded by a newer search
      const error = err as Error;
      setCheckErrorMsg(error.message || "PaloAlto check failed");
    } finally {
      if (checkAbortRef.current === controller) {
        setCheckLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (mode !== "single") return;
    const trimmed = checkInput.trim();
    setCheckResult(null);
    setCheckErrorMsg(null);
    setLiveLog([]);
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    if (!isValidIPv4(trimmed)) {
      checkAbortRef.current?.abort();
      setCheckLoading(false);
      return;
    }
    checkTimerRef.current = setTimeout(() => {
      void runPaloAltoCheck(trimmed);
    }, 450);
    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  }, [checkInput, mode, runPaloAltoCheck]);

  // Bulk mode
  const [bulkInputMode, setBulkInputMode] = useState<BulkInputMode>("cidr");
  const [bulkCidr, setBulkCidr] = useState("");
  const [bulkList, setBulkList] = useState("");
  const [bulkScanning, setBulkScanning] = useState(false);
  const [bulkResults, setBulkResults] = useState<PaloAltoCheckResult[] | null>(
    null,
  );
  const [bulkErrorMsg, setBulkErrorMsg] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkLiveLog, setBulkLiveLog] = useState<string[]>([]);
  const bulkAbortRef = useRef<AbortController | null>(null);

  const bulkIpList = bulkList
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const cidrTooLarge =
    bulkInputMode === "cidr" &&
    isValidCIDR(bulkCidr.trim()) &&
    cidrHostCount(bulkCidr.trim()) > MAX_BULK_IPS;

  const bulkExpectedTotal =
    bulkInputMode === "cidr"
      ? isValidCIDR(bulkCidr.trim())
        ? cidrHostCount(bulkCidr.trim())
        : 0
      : bulkIpList.length;

  const bulkInputValid =
    bulkInputMode === "cidr"
      ? isValidCIDR(bulkCidr.trim()) && !cidrTooLarge
      : bulkIpList.length > 0 && bulkIpList.every(isValidIPv4);

  const runBulkScan = useCallback(async (): Promise<void> => {
    bulkAbortRef.current?.abort();
    const controller = new AbortController();
    bulkAbortRef.current = controller;

    setBulkScanning(true);
    setBulkErrorMsg(null);
    setBulkResults([]);
    setBulkLiveLog([]);
    const collected: PaloAltoCheckResult[] = [];
    try {
      const body =
        bulkInputMode === "cidr"
          ? { cidr: bulkCidr.trim() }
          : { ip_addresses: bulkIpList };
      await paloaltoCheckStream(
        body,
        {
          onLog: (ip, line) =>
            setBulkLiveLog((prev) => [...prev, `[${ip}] ${line}`]),
          onResult: (result) => {
            collected.push(result);
            setBulkResults([...collected]);
          },
          onError: (message) => setBulkErrorMsg(message),
        },
        controller.signal,
      );
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const error = err as Error;
      setBulkErrorMsg(error.message || "PaloAlto subnet check failed");
    } finally {
      if (bulkAbortRef.current === controller) {
        setBulkScanning(false);
      }
    }
  }, [bulkInputMode, bulkCidr, bulkIpList]);

  const runBulkSave = useCallback(async (): Promise<void> => {
    if (!bulkResults) return;
    const foundIps = bulkResults
      .filter((r) => r.found)
      .map((r) => r.ip_address);
    if (foundIps.length === 0) return;
    setBulkSaving(true);
    try {
      const res = await integrationsApi.paloaltoSaveBulk(foundIps);
      const { created, updated, skipped, errors } = res.data;
      notification.success({
        message: `Synced to IP Records: ${created} created, ${updated} updated`,
        description:
          skipped > 0
            ? `${skipped} skipped${errors.length > 0 ? ` — ${errors.slice(0, 3).join("; ")}` : ""}`
            : undefined,
        icon: <SaveOutlined style={{ color: "#52c41a" }} />,
        duration: 8,
      });
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      notification.error({
        message: "Bulk save failed",
        description: axiosErr.response?.data?.detail ?? axiosErr.message,
      });
    } finally {
      setBulkSaving(false);
    }
  }, [bulkResults]);

  const bulkColumns: ColumnsType<PaloAltoCheckResult> = [
    {
      title: "IP Address",
      dataIndex: "ip_address",
      key: "ip_address",
      width: 160,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: "Status",
      key: "found",
      width: 130,
      render: (_: unknown, row: PaloAltoCheckResult) =>
        row.found ? (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            In Use
          </Tag>
        ) : (
          <Tag color="default" icon={<CloseCircleOutlined />}>
            Unused
          </Tag>
        ),
    },
    {
      title: "Hostname",
      dataIndex: "hostname",
      key: "hostname",
      width: 180,
      render: (v: string | null) =>
        v ? (
          <Typography.Text code>{v}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Summary",
      key: "summary",
      render: (_: unknown, row: PaloAltoCheckResult) => {
        const parts: string[] = [];
        const addrHit = row.matches.find((m) => m.address_name);
        if (addrHit) parts.push(`Address: ${addrHit.address_name}`);
        const arpHit = row.matches.find((m) => m.mac);
        if (arpHit) parts.push("Live ARP");
        if (row.nat_matches.length > 0)
          parts.push(`NAT: ${row.nat_matches.length}`);
        if (row.security_matches_total > 0)
          parts.push(`Security: ${row.security_matches_total}`);
        return parts.length > 0 ? (
          <Typography.Text type="secondary">
            {parts.join(" · ")}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        );
      },
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          <SafetyCertificateOutlined style={{ marginRight: 8 }} />
          PaloAlto Check
        </Typography.Title>
      </div>

      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value as CheckMode)}
        style={{ marginBottom: 16 }}
      >
        <Radio.Button value="single">Single IP</Radio.Button>
        <Radio.Button value="bulk">Subnet / Multiple IPs</Radio.Button>
      </Radio.Group>

      {mode === "single" ? (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Real-time PaloAlto lookup"
            description="Type an IP address — as soon as it's a valid IPv4 address, this searches every configured firewall for a named address object, a live ARP entry, a NAT rule, or a security policy that involves it. If PaloAlto shows it unused, you can cross-check Zabbix and Device42 with one click."
          />

          <Input
            size="large"
            value={checkInput}
            onChange={(e) => setCheckInput(e.target.value)}
            placeholder="e.g. 10.140.0.154"
            prefix={<SearchOutlined />}
            allowClear
            style={{ maxWidth: 360, marginBottom: 20 }}
          />

          {checkInput.trim() !== "" && !isValidIPv4(checkInput.trim()) && (
            <Alert
              type="warning"
              showIcon
              message="Not a valid IPv4 address yet"
              style={{ maxWidth: 480, marginBottom: 16 }}
            />
          )}

          {checkLoading && (
            <>
              <div style={{ padding: "12px 0" }}>
                <Spin />
                <Typography.Text style={{ marginLeft: 12 }} type="secondary">
                  Searching PaloAlto for{" "}
                  <Typography.Text code>{checkInput.trim()}</Typography.Text>…
                </Typography.Text>
              </div>
              <TerminalLog log={liveLog} live />
            </>
          )}

          {checkErrorMsg && !checkLoading && (
            <Alert
              type="error"
              showIcon
              message="Check failed"
              description={checkErrorMsg}
              style={{ marginBottom: 16 }}
            />
          )}

          {!checkLoading && !checkErrorMsg && checkResult && (
            <ResultDetail result={checkResult} />
          )}

          {!checkLoading &&
            !checkErrorMsg &&
            !checkResult &&
            checkInput.trim() === "" && (
              <Empty
                description="Type an IP address above to check it against PaloAlto"
                style={{ padding: "40px 0" }}
              />
            )}
        </>
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Bulk PaloAlto scan"
            description={`Scan a whole subnet (CIDR) or an explicit list of IPs at once — up to ${MAX_BULK_IPS} addresses per scan. Each address is checked against the same four signals as a single search; expand a row to see full details.`}
          />

          <Radio.Group
            value={bulkInputMode}
            onChange={(e) => setBulkInputMode(e.target.value as BulkInputMode)}
            style={{ marginBottom: 12 }}
          >
            <Radio.Button value="cidr">By Subnet (CIDR)</Radio.Button>
            <Radio.Button value="list">By IP List</Radio.Button>
          </Radio.Group>

          <div style={{ marginBottom: 16 }}>
            {bulkInputMode === "cidr" ? (
              <Input
                size="large"
                value={bulkCidr}
                onChange={(e) => setBulkCidr(e.target.value)}
                placeholder="e.g. 10.140.0.0/24"
                style={{ maxWidth: 360 }}
                allowClear
              />
            ) : (
              <Input.TextArea
                rows={5}
                value={bulkList}
                onChange={(e) => setBulkList(e.target.value)}
                placeholder={"10.140.0.10\n10.140.0.11\n10.140.0.12"}
                style={{ maxWidth: 480, fontFamily: "monospace", fontSize: 13 }}
              />
            )}
          </div>

          {bulkInputMode === "list" && bulkIpList.length > MAX_BULK_IPS && (
            <Alert
              type="warning"
              showIcon
              message={`Too many addresses (${bulkIpList.length}) — limit is ${MAX_BULK_IPS}`}
              style={{ maxWidth: 480, marginBottom: 16 }}
            />
          )}

          {cidrTooLarge && (
            <Alert
              type="warning"
              showIcon
              message={`${bulkCidr.trim()} has ${cidrHostCount(bulkCidr.trim())} addresses — limit is ${MAX_BULK_IPS} (up to a /24)`}
              style={{ maxWidth: 480, marginBottom: 16 }}
            />
          )}

          <Button
            type="primary"
            icon={<ScanOutlined />}
            loading={bulkScanning}
            disabled={!bulkInputValid || bulkIpList.length > MAX_BULK_IPS}
            onClick={() => void runBulkScan()}
            style={{ marginBottom: 16 }}
          >
            {bulkScanning ? "Scanning…" : "Scan"}
          </Button>

          {bulkScanning && (
            <div style={{ padding: "8px 0 24px" }}>
              <Progress
                percent={
                  bulkExpectedTotal > 0
                    ? Math.round(
                        ((bulkResults?.length ?? 0) / bulkExpectedTotal) * 100,
                      )
                    : 0
                }
                status="active"
              />
              <Typography.Text type="secondary">
                Checking PaloAlto — {bulkResults?.length ?? 0} of{" "}
                {bulkExpectedTotal || "?"} addresses done…
              </Typography.Text>
              <TerminalLog log={bulkLiveLog} live />
            </div>
          )}

          {bulkErrorMsg && !bulkScanning && (
            <Alert
              type="error"
              showIcon
              message="Scan failed"
              description={bulkErrorMsg}
              style={{ marginBottom: 16 }}
            />
          )}

          {bulkResults && bulkResults.length > 0 && (
            <>
              <Alert
                type={bulkResults.some((r) => r.found) ? "success" : "info"}
                showIcon
                message={
                  bulkScanning
                    ? `Scanning… ${bulkResults.length} of ${bulkExpectedTotal || "?"} done — ${bulkResults.filter((r) => r.found).length} in use so far`
                    : `Scanned ${bulkResults.length} address${bulkResults.length !== 1 ? "es" : ""} — ${bulkResults.filter((r) => r.found).length} in use`
                }
                style={{ marginBottom: 16 }}
              />
              {!bulkScanning && bulkResults.some((r) => r.found) && (
                <Button
                  icon={<SaveOutlined />}
                  loading={bulkSaving}
                  onClick={() => void runBulkSave()}
                  style={{ marginBottom: 16 }}
                >
                  Sync {bulkResults.filter((r) => r.found).length} found address
                  {bulkResults.filter((r) => r.found).length !== 1
                    ? "es"
                    : ""}{" "}
                  to IP Records
                </Button>
              )}
              <Table<PaloAltoCheckResult>
                dataSource={bulkResults}
                columns={bulkColumns}
                rowKey="ip_address"
                size="small"
                pagination={{
                  pageSize: 20,
                  showTotal: (t) => `${t} addresses`,
                }}
                expandable={{
                  expandedRowRender: (row) => (
                    <div style={{ padding: "8px 0" }}>
                      <ResultDetail result={row} />
                    </div>
                  ),
                }}
              />
            </>
          )}

          {!bulkScanning && !bulkResults?.length && !bulkErrorMsg && (
            <Empty
              description="Enter a subnet or IP list above and click Scan"
              style={{ padding: "40px 0" }}
            />
          )}
        </>
      )}

      <RecentChecksPanel />
    </div>
  );
};

export default PaloAltoCheckPage;

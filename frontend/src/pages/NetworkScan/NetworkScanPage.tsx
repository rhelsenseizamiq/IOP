import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Input,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Progress,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  AimOutlined,
  BugOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  ImportOutlined,
  ScanOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  WifiOutlined,
  PlusCircleOutlined,
  ApartmentOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { scanApi, SCAN_MODES } from "../../api/scan";
import type {
  DiscoverScanResult,
  ScanMode,
  ScanModeInfo,
  DiscoveredHost,
} from "../../api/scan";
import { ipRecordsApi } from "../../api/ipRecords";
import { subnetsApi } from "../../api/subnets";
import CreateSubnetModal from "./CreateSubnetModal";
import type { SubnetDetail } from "../../types/subnet";
import type { OSType, Environment } from "../../types/ipRecord";
import { ENV_OPTIONS, ENV_COLOR } from "../../constants/environments";

const OS_OPTIONS: OSType[] = [
  "AIX",
  "Linux",
  "Windows",
  "macOS",
  "OpenShift",
  "Unknown",
];

const MODE_ICON: Record<ScanMode, React.ReactNode> = {
  quick: <ThunderboltOutlined />,
  standard: <AimOutlined />,
  deep: <BugOutlined />,
};

// A scan wide enough to take a while (large CIDR list and/or deep mode)
// asks for confirmation with a time estimate first — same reasoning as the
// Bulk Scan confirmation on the IP Records page: a real production run
// shouldn't launch a multi-minute job with no warning.
const CONFIRM_SECS_THRESHOLD = 60;

type SaveMode = "review" | "auto";

interface ScanRow {
  key: string;
  ip_address: string;
  hostname: string;
  os_type: OSType;
  open_ports: number[];
  subnet_id: string | null;
  subnet_cidr: string | null;
}

interface SubnetGroup {
  subnet: SubnetDetail | null;
  rows: ScanRow[];
}

interface ReviewScanInfo {
  cidrs: string[];
  mode: string;
  total: number;
  found: number;
  duration: number;
}

function ipToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

function isIPInCIDR(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
}

function findSubnetForIP(
  ip: string,
  subnets: SubnetDetail[],
): SubnetDetail | null {
  let best: SubnetDetail | null = null;
  let bestPrefix = -1;
  for (const s of subnets) {
    const prefix = parseInt(s.cidr.split("/")[1], 10);
    if (prefix > bestPrefix && isIPInCIDR(ip, s.cidr)) {
      best = s;
      bestPrefix = prefix;
    }
  }
  return best;
}

function parseCidrs(text: string): string[] {
  return [...new Set(text.split(/[\n,]+/).map((c) => c.trim()).filter(Boolean))];
}

function estimateHosts(cidr: string): number {
  try {
    const prefix = parseInt(cidr.split("/")[1], 10);
    return Math.max(0, 2 ** (32 - prefix) - 2);
  } catch {
    return 100;
  }
}

function estimateSecs(hosts: number, mode: string): number {
  const profiles: Record<string, { c: number; t: number }> = {
    quick: { c: 150, t: 0.22 },
    standard: { c: 50, t: 0.55 },
    deep: { c: 25, t: 1.1 },
  };
  const p = profiles[mode] ?? profiles["standard"];
  return Math.max(2, Math.ceil(hosts / p.c) * p.t * 1.25);
}

function formatMinutes(secs: number): string {
  const mins = Math.max(1, Math.round(secs / 60));
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

function startProgressTimer(
  estimatedMs: number,
  setter: (v: number) => void,
): ReturnType<typeof setInterval> {
  const steps = 40;
  const intervalMs = Math.max(100, estimatedMs / steps);
  let current = 0;
  return setInterval(() => {
    current = Math.min(93, current + 88 / steps + Math.random() * 2);
    setter(Math.round(current));
  }, intervalMs);
}

// ── Mode selector card ────────────────────────────────────────────────────────

const ModeCard: React.FC<{
  info: ScanModeInfo;
  selected: boolean;
  onClick: () => void;
}> = ({ info, selected, onClick }) => (
  <Card
    size="small"
    onClick={onClick}
    style={{
      cursor: "pointer",
      border: selected
        ? `2px solid ${info.color}`
        : "1px solid rgba(255, 255, 255, 0.15)",
      background: selected ? `${info.color}1a` : "rgba(255, 255, 255, 0.04)",
      transition: "all 0.2s",
      userSelect: "none",
    }}
    styles={{ body: { padding: "10px 14px" } }}
  >
    <Space direction="vertical" size={2} style={{ width: "100%" }}>
      <Space>
        <span style={{ color: info.color, fontSize: 16 }}>
          {MODE_ICON[info.key]}
        </span>
        <Typography.Text strong style={{ color: info.color }}>
          {info.label}
        </Typography.Text>
        {selected && <Badge status="processing" color={info.color} />}
      </Space>
      <Typography.Text style={{ fontSize: 13 }}>
        {info.description}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {info.detail}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        Max: <strong>{info.maxCidr}</strong> ({info.maxHosts} hosts)
      </Typography.Text>
    </Space>
  </Card>
);

// ── Main page ─────────────────────────────────────────────────────────────────
// Host Discovery (review-then-import) and Infrastructure Scan (scan-and-save)
// used to be two separate tabs running the same underlying network probe —
// merged into one flow: scan once, then choose what happens to the results.

const NetworkScanPage: React.FC = () => {
  const [subnets, setSubnets] = useState<SubnetDetail[]>([]);
  const [cidrsText, setCidrsText] = useState("");
  const [mode, setMode] = useState<ScanMode>("standard");
  const [saveMode, setSaveMode] = useState<SaveMode>("review");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Review & Import mode state
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [scanInfo, setScanInfo] = useState<ReviewScanInfo | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [importEnv, setImportEnv] = useState<Environment | undefined>();
  const [importOwner, setImportOwner] = useState("");
  const [importing, setImporting] = useState(false);

  // Auto-Save mode state
  const [saveInactive, setSaveInactive] = useState(false);
  const [overwriteStatus, setOverwriteStatus] = useState(false);
  const [autoResult, setAutoResult] = useState<DiscoverScanResult | null>(
    null,
  );

  // Subnet creation modal for unmatched hosts (Review mode only)
  const [createModal, setCreateModal] = useState<{
    open: boolean;
    forIp: string;
    suggestedCidr: string;
  }>({
    open: false,
    forIp: "",
    suggestedCidr: "",
  });

  const fetchSubnets = useCallback(async () => {
    try {
      const res = await subnetsApi.list({ page_size: 200 });
      setSubnets(res.data.items);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    void fetchSubnets();
  }, [fetchSubnets]);

  const cidrList = useMemo(() => parseCidrs(cidrsText), [cidrsText]);
  const totalEstHosts = useMemo(
    () => cidrList.reduce((acc, c) => acc + estimateHosts(c), 0),
    [cidrList],
  );
  const estSecs = useMemo(
    () => estimateSecs(totalEstHosts, mode),
    [totalEstHosts, mode],
  );
  const needsConfirm = estSecs > CONFIRM_SECS_THRESHOLD;

  const groups = useMemo<SubnetGroup[]>(() => {
    const map = new Map<string, SubnetGroup>();
    const unmatched: ScanRow[] = [];
    for (const row of rows) {
      if (!row.subnet_id) {
        unmatched.push(row);
        continue;
      }
      const existing = map.get(row.subnet_id);
      if (existing) {
        existing.rows.push(row);
      } else {
        const subnet = subnets.find((s) => s.id === row.subnet_id) ?? null;
        map.set(row.subnet_id, { subnet, rows: [row] });
      }
    }
    const result: SubnetGroup[] = [...map.values()].sort((a, b) =>
      (a.subnet?.cidr ?? "").localeCompare(b.subnet?.cidr ?? ""),
    );
    if (unmatched.length > 0) result.push({ subnet: null, rows: unmatched });
    return result;
  }, [rows, subnets]);

  const importableCount = useMemo(
    () =>
      selectedKeys.filter((k) =>
        rows.find((r) => r.key === k && r.subnet_id !== null),
      ).length,
    [selectedKeys, rows],
  );

  const clearResults = useCallback(() => {
    setRows([]);
    setScanInfo(null);
    setSelectedKeys([]);
    setAutoResult(null);
  }, []);

  const handleScan = useCallback(async () => {
    if (cidrList.length === 0) {
      message.warning("Enter at least one CIDR to scan");
      return;
    }
    setScanning(true);
    clearResults();
    setProgress(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = startProgressTimer(estSecs * 1000, setProgress);

    try {
      if (saveMode === "review") {
        const responses = await Promise.all(
          cidrList.map((c) => scanApi.scan({ cidr: c, mode })),
        );
        let totalScanned = 0;
        let totalDuration = 0;
        const allHosts: DiscoveredHost[] = [];
        for (const res of responses) {
          totalScanned += res.data.total_scanned;
          totalDuration += res.data.duration_seconds;
          allHosts.push(...res.data.discovered);
        }

        const mapped: ScanRow[] = allHosts.map((host) => {
          const matched = findSubnetForIP(host.ip_address, subnets);
          return {
            key: host.ip_address,
            ip_address: host.ip_address,
            hostname: host.hostname ?? "",
            os_type: (host.os_hint as OSType) ?? "Unknown",
            open_ports: host.open_ports,
            subnet_id: matched?.id ?? null,
            subnet_cidr: matched?.cidr ?? null,
          };
        });

        setRows(mapped);
        setSelectedKeys(
          mapped.filter((r) => r.subnet_id !== null).map((r) => r.key),
        );
        setScanInfo({
          cidrs: cidrList,
          mode,
          total: totalScanned,
          found: allHosts.length,
          duration: Math.round(totalDuration * 10) / 10,
        });
      } else {
        const res = await scanApi.discover({
          cidrs: cidrList,
          mode,
          save_inactive: saveInactive,
          overwrite_status: overwriteStatus,
        });
        setAutoResult(res.data);
        void message.success(
          `Scan complete: ${res.data.created} new, ${res.data.updated} updated, ${res.data.skipped} skipped`,
        );
      }
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      message.error(
        axiosErr.response?.data?.detail ?? axiosErr.message ?? "Scan failed",
      );
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setProgress(100);
      setTimeout(() => setProgress(0), 1000);
      setScanning(false);
    }
  }, [
    cidrList,
    mode,
    saveMode,
    subnets,
    saveInactive,
    overwriteStatus,
    estSecs,
    clearResults,
  ]);

  const updateRow = useCallback(
    (ip: string, field: "hostname" | "os_type", value: string) => {
      setRows((prev) =>
        prev.map((r) => (r.ip_address === ip ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

  const handleImport = useCallback(async () => {
    if (!importEnv) {
      message.warning("Please select an Environment before importing");
      return;
    }
    const toImport = rows.filter(
      (r) => selectedKeys.includes(r.key) && r.subnet_id !== null,
    );
    if (!toImport.length) {
      message.warning("No matched hosts selected");
      return;
    }
    setImporting(true);
    let ok = 0;
    let errors = 0;
    for (const row of toImport) {
      try {
        await ipRecordsApi.create({
          ip_address: row.ip_address,
          hostname: row.hostname || undefined,
          os_type: row.os_type,
          subnet_id: row.subnet_id!,
          status: "Reserved",
          environment: importEnv,
          owner: importOwner || undefined,
        });
        ok++;
      } catch {
        errors++;
      }
    }
    setImporting(false);
    if (errors === 0) {
      message.success(`Imported ${ok} host(s) successfully`);
      setRows([]);
      setScanInfo(null);
      setSelectedKeys([]);
    } else {
      message.warning(
        `Imported ${ok} host(s); ${errors} skipped (already exist or conflict)`,
      );
    }
  }, [rows, selectedKeys, importEnv, importOwner]);

  const assignSubnetToRow = useCallback(
    (ip: string, subnetId: string, subnetCidr: string) => {
      setRows((prev) =>
        prev.map((r) =>
          r.ip_address === ip
            ? { ...r, subnet_id: subnetId, subnet_cidr: subnetCidr }
            : r,
        ),
      );
      setSelectedKeys((prev) => [...new Set([...prev, ip])]);
    },
    [],
  );

  const suggestCidr = (ip: string): string => {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  };

  const handleSubnetCreated = useCallback(
    (subnet: SubnetDetail) => {
      setSubnets((prev) => [...prev, subnet]);
      assignSubnetToRow(createModal.forIp, subnet.id, subnet.cidr);
      setCreateModal({ open: false, forIp: "", suggestedCidr: "" });
    },
    [createModal.forIp, assignSubnetToRow],
  );

  const toggleGroupSelection = (groupRows: ScanRow[], allSelected: boolean) => {
    const keys = groupRows.map((r) => r.key);
    if (allSelected) {
      setSelectedKeys((prev) => prev.filter((k) => !keys.includes(k)));
    } else {
      setSelectedKeys((prev) => [...new Set([...prev, ...keys])]);
    }
  };

  const buildColumns = (isUnmatched: boolean): ColumnsType<ScanRow> => {
    const cols: ColumnsType<ScanRow> = [
      {
        title: "IP Address",
        dataIndex: "ip_address",
        key: "ip_address",
        width: 140,
        render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
      },
      {
        title: "Hostname",
        dataIndex: "hostname",
        key: "hostname",
        render: (v: string, record: ScanRow) => (
          <Input
            size="small"
            value={v}
            placeholder="—"
            onChange={(e) =>
              updateRow(record.ip_address, "hostname", e.target.value)
            }
            style={{ minWidth: 170 }}
          />
        ),
      },
      {
        title: "OS Type",
        dataIndex: "os_type",
        key: "os_type",
        width: 145,
        render: (v: OSType, record: ScanRow) => (
          <Select<OSType>
            size="small"
            value={v}
            style={{ width: 128 }}
            onChange={(val) => updateRow(record.ip_address, "os_type", val)}
          >
            {OS_OPTIONS.map((o) => (
              <Select.Option key={o} value={o}>
                {o}
              </Select.Option>
            ))}
          </Select>
        ),
      },
    ];

    // Show open ports only for deep scan results
    if (mode === "deep") {
      cols.push({
        title: "Open Ports",
        dataIndex: "open_ports",
        key: "open_ports",
        render: (ports: number[]) =>
          ports.length === 0 ? (
            <Typography.Text type="secondary">—</Typography.Text>
          ) : (
            <Tooltip title={ports.join(", ")}>
              <Space size={2} wrap>
                {ports.slice(0, 6).map((p) => (
                  <Tag
                    key={p}
                    style={{ fontSize: 11, padding: "0 4px", marginBottom: 2 }}
                  >
                    {p}
                  </Tag>
                ))}
                {ports.length > 6 && (
                  <Tag style={{ fontSize: 11, padding: "0 4px" }}>
                    +{ports.length - 6}
                  </Tag>
                )}
              </Space>
            </Tooltip>
          ),
      });
    }

    if (isUnmatched) {
      cols.push({
        title: "Assign Subnet",
        key: "assign_subnet",
        width: 260,
        render: (_: unknown, record: ScanRow) => (
          <Select
            size="small"
            placeholder="Select or create subnet…"
            style={{ width: 240 }}
            onChange={(val: string) => {
              if (val === "__create__") {
                setCreateModal({
                  open: true,
                  forIp: record.ip_address,
                  suggestedCidr: suggestCidr(record.ip_address),
                });
              } else {
                const sub = subnets.find((s) => s.id === val);
                if (sub) assignSubnetToRow(record.ip_address, sub.id, sub.cidr);
              }
            }}
            dropdownRender={(menu) => (
              <>
                {menu}
                <div
                  style={{
                    padding: "6px 12px",
                    cursor: "pointer",
                    color: "#1677ff",
                    borderTop: "1px solid rgba(255, 255, 255, 0.12)",
                    fontWeight: 500,
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    setCreateModal({
                      open: true,
                      forIp: record.ip_address,
                      suggestedCidr: suggestCidr(record.ip_address),
                    })
                  }
                >
                  + Create new subnet…
                </div>
              </>
            )}
          >
            {subnets.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                {s.cidr} — {s.name}
              </Select.Option>
            ))}
          </Select>
        ),
      });
    } else {
      cols.push({
        title: "Status",
        key: "status",
        width: 100,
        render: () => <Tag color="orange">Reserved</Tag>,
      });
    }

    return cols;
  };

  const selectedModeInfo = SCAN_MODES.find((m) => m.key === mode)!;

  const scanButtonLabel = scanning
    ? "Scanning…"
    : saveMode === "review"
      ? `${selectedModeInfo.label} Scan`
      : `Run ${selectedModeInfo.label} Infrastructure Scan`;

  const scanButton = (
    <Button
      type="primary"
      icon={<ScanOutlined />}
      loading={scanning}
      disabled={cidrList.length === 0}
      onClick={needsConfirm ? undefined : () => void handleScan()}
      style={{
        background: selectedModeInfo.color,
        borderColor: selectedModeInfo.color,
      }}
    >
      {scanButtonLabel}
    </Button>
  );

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
          <WifiOutlined style={{ marginRight: 8 }} />
          Network Scanner
        </Typography.Title>
      </div>

      {/* Scan mode selector */}
      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
          Scan Mode:
        </Typography.Text>
        <Row gutter={12}>
          {SCAN_MODES.map((info) => (
            <Col xs={24} sm={8} key={info.key}>
              <ModeCard
                info={info}
                selected={mode === info.key}
                onClick={() => {
                  setMode(info.key);
                  clearResults();
                }}
              />
            </Col>
          ))}
        </Row>
      </div>

      {/* CIDR input */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
          Network CIDR(s) — one per line or comma-separated:
        </Typography.Text>
        <Input.TextArea
          rows={3}
          value={cidrsText}
          onChange={(e) => setCidrsText(e.target.value)}
          placeholder={`e.g. 192.168.1.0/24, 10.0.0.0/24   (max ${selectedModeInfo.maxCidr} per network for ${selectedModeInfo.label} scan)`}
          style={{ fontFamily: "monospace", fontSize: 13 }}
        />
      </Card>

      {/* Save mode selector */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
          What to do with results:
        </Typography.Text>
        <Segmented
          value={saveMode}
          onChange={(v) => {
            setSaveMode(v as SaveMode);
            clearResults();
          }}
          options={[
            {
              label: (
                <Space>
                  <WifiOutlined />
                  Review &amp; Import
                </Space>
              ),
              value: "review",
            },
            {
              label: (
                <Space>
                  <DatabaseOutlined />
                  Auto-Save to Database
                </Space>
              ),
              value: "auto",
            },
          ]}
        />
        <div style={{ marginTop: 10 }}>
          {saveMode === "review" ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Discovered hosts are shown for review first — pick which ones
              to import as Reserved records, with the option to assign a
              hostname, OS type, and subnet per host.
            </Typography.Text>
          ) : (
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Discovered (active) hosts are stored directly as{" "}
                <Tag color="green">In Use</Tag>. IPs without a matching
                subnet in your database are skipped — add subnets first.
              </Typography.Text>
              <Row gutter={24}>
                <Col>
                  <Space align="start">
                    <Switch
                      checked={saveInactive}
                      onChange={setSaveInactive}
                      size="small"
                    />
                    <Typography.Text style={{ fontSize: 13 }}>
                      Store non-responding IPs as{" "}
                      <Tag color="default">Free</Tag>
                    </Typography.Text>
                  </Space>
                </Col>
                <Col>
                  <Space align="start">
                    <Switch
                      checked={overwriteStatus}
                      onChange={setOverwriteStatus}
                      size="small"
                    />
                    <Typography.Text style={{ fontSize: 13 }}>
                      Overwrite existing record status
                    </Typography.Text>
                  </Space>
                </Col>
              </Row>
            </Space>
          )}
        </div>
      </Card>

      {/* Scan trigger — large scans confirm with a time estimate first */}
      <div style={{ marginBottom: 20 }}>
        {needsConfirm ? (
          <Popconfirm
            title={`This covers ~${totalEstHosts.toLocaleString()} host(s) across ${cidrList.length} network${cidrList.length === 1 ? "" : "s"}`}
            description={
              <span>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                Estimated time: ~{formatMinutes(estSecs)}. Continue?
              </span>
            }
            onConfirm={() => void handleScan()}
            okText="Start Scan"
            cancelText="Cancel"
            disabled={cidrList.length === 0}
          >
            {scanButton}
          </Popconfirm>
        ) : (
          scanButton
        )}
      </div>

      {scanning && (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <Progress
            type="circle"
            percent={progress}
            status={progress < 100 ? "active" : "success"}
            strokeColor={selectedModeInfo.color}
            size={100}
          />
          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">
              Running <strong>{selectedModeInfo.label}</strong> scan on{" "}
              {cidrList.map((c) => (
                <Typography.Text code key={c} style={{ marginRight: 4 }}>
                  {c}
                </Typography.Text>
              ))}
              {saveMode === "auto" ? "and saving to database…" : "…"}
            </Typography.Text>
          </div>
        </div>
      )}

      {/* ── Review & Import results ─────────────────────────────────────── */}
      {saveMode === "review" && !scanning && scanInfo && (
        <>
          <Alert
            type={scanInfo.found > 0 ? "success" : "info"}
            message={
              <span>
                <Tag color={selectedModeInfo.color}>
                  {scanInfo.mode.toUpperCase()} SCAN
                </Tag>{" "}
                <Typography.Text code>
                  {scanInfo.cidrs.join(", ")}
                </Typography.Text>{" "}
                — found <strong>{scanInfo.found}</strong> live host
                {scanInfo.found !== 1 ? "s" : ""} out of{" "}
                <strong>{scanInfo.total}</strong> in{" "}
                <strong>{scanInfo.duration}s</strong>.
                {rows.filter((r) => r.subnet_id === null).length > 0 && (
                  <span style={{ color: "#faad14", marginLeft: 8 }}>
                    {rows.filter((r) => r.subnet_id === null).length} host(s)
                    have no matching subnet.
                  </span>
                )}
              </span>
            }
            style={{ marginBottom: 16 }}
          />

          {scanInfo.found > 0 && (
            <>
              <Card
                size="small"
                title="Import Settings"
                style={{ marginBottom: 16 }}
                extra={
                  <Button
                    type="primary"
                    icon={<ImportOutlined />}
                    loading={importing}
                    disabled={importableCount === 0}
                    onClick={() => void handleImport()}
                  >
                    Import Selected ({importableCount})
                  </Button>
                }
              >
                <Row gutter={16} align="middle">
                  <Col>
                    <Space>
                      <Typography.Text strong>Environment:</Typography.Text>
                      <Select<Environment>
                        placeholder="Select (required)"
                        style={{ width: 200 }}
                        value={importEnv}
                        onChange={setImportEnv}
                      >
                        {ENV_OPTIONS.map((e) => (
                          <Select.Option key={e} value={e}>
                            <Tag color={ENV_COLOR[e]}>{e}</Tag>
                          </Select.Option>
                        ))}
                      </Select>
                    </Space>
                  </Col>
                  <Col>
                    <Space>
                      <Typography.Text strong>Owner:</Typography.Text>
                      <Input
                        placeholder="Optional"
                        style={{ width: 180 }}
                        value={importOwner}
                        onChange={(e) => setImportOwner(e.target.value)}
                      />
                    </Space>
                  </Col>
                </Row>
              </Card>

              {groups.map((group, idx) => {
                const isUnmatched = group.subnet === null;
                const groupKeys = group.rows.map((r) => r.key);
                const allSelected =
                  groupKeys.length > 0 &&
                  groupKeys.every((k) => selectedKeys.includes(k));
                const someSelected = groupKeys.some((k) =>
                  selectedKeys.includes(k),
                );
                return (
                  <div
                    key={group.subnet?.id ?? "__unmatched__"}
                    style={{ marginBottom: 24 }}
                  >
                    <Divider
                      orientation="left"
                      style={{ marginTop: idx === 0 ? 0 : undefined }}
                    >
                      {isUnmatched ? (
                        <Space>
                          <WarningOutlined style={{ color: "#faad14" }} />
                          <Typography.Text type="warning">
                            No matching subnet — {group.rows.length} host
                            {group.rows.length !== 1 ? "s" : ""}
                            &nbsp;(create subnets first to import)
                          </Typography.Text>
                        </Space>
                      ) : (
                        <Space>
                          <Typography.Text code>
                            {group.subnet!.cidr}
                          </Typography.Text>
                          <Typography.Text strong>
                            {group.subnet!.name}
                          </Typography.Text>
                          <Tag color="blue">
                            {group.rows.length} host
                            {group.rows.length !== 1 ? "s" : ""}
                          </Tag>
                        </Space>
                      )}
                    </Divider>
                    {!isUnmatched && (
                      <div style={{ marginBottom: 6 }}>
                        <Checkbox
                          indeterminate={someSelected && !allSelected}
                          checked={allSelected}
                          onChange={() =>
                            toggleGroupSelection(group.rows, allSelected)
                          }
                        >
                          Select all in this subnet
                        </Checkbox>
                      </div>
                    )}
                    <Table<ScanRow>
                      dataSource={group.rows}
                      columns={buildColumns(isUnmatched)}
                      rowKey="key"
                      size="small"
                      pagination={false}
                      scroll={{ x: mode === "deep" ? 900 : 700 }}
                      rowSelection={
                        isUnmatched
                          ? undefined
                          : {
                              selectedRowKeys: selectedKeys,
                              onChange: (keys) =>
                                setSelectedKeys((prev) => {
                                  const others = prev.filter(
                                    (k) => !groupKeys.includes(k),
                                  );
                                  return [...others, ...(keys as string[])];
                                }),
                            }
                      }
                    />
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {/* ── Auto-Save results ───────────────────────────────────────────── */}
      {saveMode === "auto" && !scanning && autoResult && (
        <>
          <Alert
            type={autoResult.errors.length > 0 ? "warning" : "success"}
            showIcon
            message={
              <Space wrap>
                <span>
                  Done in <strong>{autoResult.duration_seconds}s</strong>
                </span>
                <Tag color="blue">Scanned: {autoResult.total_scanned}</Tag>
                <Tag color="green">Active: {autoResult.total_discovered}</Tag>
                <Tag color="cyan">Created: {autoResult.created}</Tag>
                <Tag color="purple">Updated: {autoResult.updated}</Tag>
                <Tag color="default">Skipped: {autoResult.skipped}</Tag>
                {autoResult.auto_created_subnets > 0 && (
                  <Tag color="orange">
                    Auto-subnets: {autoResult.auto_created_subnets}
                  </Tag>
                )}
              </Space>
            }
            description={
              autoResult.errors.length > 0 ? (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer" }}>
                    {autoResult.errors.length} error(s)
                  </summary>
                  <ul style={{ margin: "8px 0 0 0", paddingLeft: 16 }}>
                    {autoResult.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {autoResult.errors.length > 20 && (
                      <li>…and {autoResult.errors.length - 20} more</li>
                    )}
                  </ul>
                </details>
              ) : undefined
            }
          />
          {autoResult.created_ips.length > 0 && (
            <Card
              size="small"
              style={{ marginTop: 16 }}
              title={
                <Space>
                  <PlusCircleOutlined style={{ color: "#52c41a" }} />
                  <Typography.Text strong>
                    New IPs Added ({autoResult.created_ips.length})
                  </Typography.Text>
                </Space>
              }
            >
              <Table
                dataSource={autoResult.created_ips.map((ip) => ({
                  ip,
                  key: ip,
                }))}
                columns={[
                  {
                    title: "IP Address",
                    dataIndex: "ip",
                    width: 160,
                    render: (v: string) => (
                      <Typography.Text code copyable>
                        {v}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: "Subnet",
                    key: "subnet",
                    render: (_: unknown, row: { ip: string }) => {
                      const matched = subnets.find((sub) =>
                        isIPInCIDR(row.ip, sub.cidr),
                      );
                      return matched ? (
                        <Space size={4}>
                          <Typography.Text code>
                            {matched.cidr}
                          </Typography.Text>
                          <Typography.Text type="secondary">
                            {matched.name}
                          </Typography.Text>
                        </Space>
                      ) : (
                        <Typography.Text type="secondary">—</Typography.Text>
                      );
                    },
                  },
                ]}
                size="small"
                pagination={{
                  pageSize: 10,
                  hideOnSinglePage: true,
                  showTotal: (t) => `${t} IPs`,
                }}
                scroll={{ y: 300 }}
              />
            </Card>
          )}
          {autoResult.updated_ips.length > 0 && (
            <Card
              size="small"
              style={{ marginTop: 12 }}
              title={
                <Space>
                  <DatabaseOutlined style={{ color: "#722ed1" }} />
                  <Typography.Text strong>
                    Updated IPs ({autoResult.updated_ips.length})
                  </Typography.Text>
                </Space>
              }
            >
              <Table
                dataSource={autoResult.updated_ips.map((ip) => ({
                  ip,
                  key: ip,
                }))}
                columns={[
                  {
                    title: "IP Address",
                    dataIndex: "ip",
                    width: 160,
                    render: (v: string) => (
                      <Typography.Text code copyable>
                        {v}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: "Subnet",
                    key: "subnet",
                    render: (_: unknown, row: { ip: string }) => {
                      const matched = subnets.find((sub) =>
                        isIPInCIDR(row.ip, sub.cidr),
                      );
                      return matched ? (
                        <Space size={4}>
                          <Typography.Text code>
                            {matched.cidr}
                          </Typography.Text>
                          <Typography.Text type="secondary">
                            {matched.name}
                          </Typography.Text>
                        </Space>
                      ) : (
                        <Typography.Text type="secondary">—</Typography.Text>
                      );
                    },
                  },
                ]}
                size="small"
                pagination={{
                  pageSize: 10,
                  hideOnSinglePage: true,
                  showTotal: (t) => `${t} IPs`,
                }}
                scroll={{ y: 300 }}
              />
            </Card>
          )}
          {autoResult.auto_created_subnet_cidrs.length > 0 && (
            <Card
              size="small"
              style={{ marginTop: 12 }}
              title={
                <Space>
                  <ApartmentOutlined style={{ color: "#faad14" }} />
                  <Typography.Text strong>
                    Auto-Created Subnets (
                    {autoResult.auto_created_subnet_cidrs.length})
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, fontWeight: 400 }}
                  >
                    — /24 subnets created automatically for unmatched IPs
                  </Typography.Text>
                </Space>
              }
            >
              <Table
                dataSource={autoResult.auto_created_subnet_cidrs.map(
                  (cidr) => ({ cidr, key: cidr }),
                )}
                columns={[
                  {
                    title: "CIDR",
                    dataIndex: "cidr",
                    render: (v: string) => (
                      <Typography.Text code copyable>
                        {v}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: "Name",
                    key: "name",
                    render: () => (
                      <Typography.Text type="secondary">
                        Auto-created (scan)
                      </Typography.Text>
                    ),
                  },
                ]}
                size="small"
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
              />
            </Card>
          )}
        </>
      )}

      <CreateSubnetModal
        open={createModal.open}
        suggestedCidr={createModal.suggestedCidr}
        onCreated={handleSubnetCreated}
        onCancel={() =>
          setCreateModal({ open: false, forIp: "", suggestedCidr: "" })
        }
      />
    </div>
  );
};

export default NetworkScanPage;

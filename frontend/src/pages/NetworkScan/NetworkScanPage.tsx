import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  AimOutlined,
  BugOutlined,
  DatabaseOutlined,
  ImportOutlined,
  ScanOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { scanApi, SCAN_MODES } from '../../api/scan';
import type { DiscoverScanResult, ScanMode, ScanModeInfo, DiscoveredHost } from '../../api/scan';
import { ipRecordsApi } from '../../api/ipRecords';
import { subnetsApi } from '../../api/subnets';
import CreateSubnetModal from './CreateSubnetModal';
import type { SubnetDetail } from '../../types/subnet';
import type { OSType, Environment } from '../../types/ipRecord';
import { ENV_OPTIONS, ENV_COLOR } from '../../constants/environments';

const OS_OPTIONS: OSType[] = ['AIX', 'Linux', 'Windows', 'macOS', 'OpenShift', 'Unknown'];

const MODE_ICON: Record<ScanMode, React.ReactNode> = {
  quick: <ThunderboltOutlined />,
  standard: <AimOutlined />,
  deep: <BugOutlined />,
};

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

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

function isIPInCIDR(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
}

function findSubnetForIP(ip: string, subnets: SubnetDetail[]): SubnetDetail | null {
  let best: SubnetDetail | null = null;
  let bestPrefix = -1;
  for (const s of subnets) {
    const prefix = parseInt(s.cidr.split('/')[1], 10);
    if (prefix > bestPrefix && isIPInCIDR(ip, s.cidr)) {
      best = s;
      bestPrefix = prefix;
    }
  }
  return best;
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
      cursor: 'pointer',
      border: selected ? `2px solid ${info.color}` : '1px solid #d9d9d9',
      background: selected ? `${info.color}08` : '#fff',
      transition: 'all 0.2s',
      userSelect: 'none',
    }}
    styles={{ body: { padding: '10px 14px' } }}
  >
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Space>
        <span style={{ color: info.color, fontSize: 16 }}>{MODE_ICON[info.key]}</span>
        <Typography.Text strong style={{ color: info.color }}>
          {info.label}
        </Typography.Text>
        {selected && <Badge status="processing" color={info.color} />}
      </Space>
      <Typography.Text style={{ fontSize: 13 }}>{info.description}</Typography.Text>
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

const NetworkScanPage: React.FC = () => {
  const [subnets, setSubnets] = useState<SubnetDetail[]>([]);
  const [cidr, setCidr] = useState('');
  const [mode, setMode] = useState<ScanMode>('standard');
  const [scanning, setScanning] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [scanInfo, setScanInfo] = useState<{
    cidr: string;
    mode: string;
    total: number;
    found: number;
    duration: number;
  } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [importEnv, setImportEnv] = useState<Environment | undefined>();
  const [importOwner, setImportOwner] = useState('');
  const [importing, setImporting] = useState(false);

  // Subnet creation modal for unmatched hosts
  const [createModal, setCreateModal] = useState<{ open: boolean; forIp: string; suggestedCidr: string }>({
    open: false,
    forIp: '',
    suggestedCidr: '',
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
      (a.subnet?.cidr ?? '').localeCompare(b.subnet?.cidr ?? '')
    );
    if (unmatched.length > 0) result.push({ subnet: null, rows: unmatched });
    return result;
  }, [rows, subnets]);

  const importableCount = useMemo(
    () => selectedKeys.filter((k) => rows.find((r) => r.key === k && r.subnet_id !== null)).length,
    [selectedKeys, rows]
  );

  const handleScan = useCallback(async () => {
    const trimmed = cidr.trim();
    if (!trimmed) {
      message.warning('Please enter a CIDR to scan');
      return;
    }
    setScanning(true);
    setRows([]);
    setScanInfo(null);
    setSelectedKeys([]);
    try {
      const res = await scanApi.scan({ cidr: trimmed, mode });
      const { discovered, cidr: scanned, total_scanned, duration_seconds, mode: usedMode } = res.data;

      const mapped: ScanRow[] = discovered.map((host: DiscoveredHost) => {
        const matched = findSubnetForIP(host.ip_address, subnets);
        return {
          key: host.ip_address,
          ip_address: host.ip_address,
          hostname: host.hostname ?? '',
          os_type: (host.os_hint as OSType) ?? 'Unknown',
          open_ports: host.open_ports,
          subnet_id: matched?.id ?? null,
          subnet_cidr: matched?.cidr ?? null,
        };
      });

      setRows(mapped);
      setSelectedKeys(mapped.filter((r) => r.subnet_id !== null).map((r) => r.key));
      setScanInfo({ cidr: scanned, mode: usedMode, total: total_scanned, found: discovered.length, duration: duration_seconds });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Scan failed');
    } finally {
      setScanning(false);
    }
  }, [cidr, mode, subnets]);

  const updateRow = useCallback((ip: string, field: 'hostname' | 'os_type', value: string) => {
    setRows((prev) => prev.map((r) => (r.ip_address === ip ? { ...r, [field]: value } : r)));
  }, []);

  const handleImport = useCallback(async () => {
    if (!importEnv) {
      message.warning('Please select an Environment before importing');
      return;
    }
    const toImport = rows.filter((r) => selectedKeys.includes(r.key) && r.subnet_id !== null);
    if (!toImport.length) {
      message.warning('No matched hosts selected');
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
          status: 'Reserved',
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
      message.warning(`Imported ${ok} host(s); ${errors} skipped (already exist or conflict)`);
    }
  }, [rows, selectedKeys, importEnv, importOwner]);

  const assignSubnetToRow = useCallback((ip: string, subnetId: string, subnetCidr: string) => {
    setRows((prev) =>
      prev.map((r) => (r.ip_address === ip ? { ...r, subnet_id: subnetId, subnet_cidr: subnetCidr } : r))
    );
    setSelectedKeys((prev) => [...new Set([...prev, ip])]);
  }, []);

  const suggestCidr = (ip: string): string => {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  };

  const handleSubnetCreated = useCallback(
    (subnet: SubnetDetail) => {
      setSubnets((prev) => [...prev, subnet]);
      assignSubnetToRow(createModal.forIp, subnet.id, subnet.cidr);
      setCreateModal({ open: false, forIp: '', suggestedCidr: '' });
    },
    [createModal.forIp, assignSubnetToRow]
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
        render: (v: string, record: ScanRow) => (
          <Input
            size="small"
            value={v}
            placeholder="—"
            onChange={(e) => updateRow(record.ip_address, 'hostname', e.target.value)}
            style={{ minWidth: 170 }}
          />
        ),
      },
      {
        title: 'OS Type',
        dataIndex: 'os_type',
        key: 'os_type',
        width: 145,
        render: (v: OSType, record: ScanRow) => (
          <Select<OSType>
            size="small"
            value={v}
            style={{ width: 128 }}
            onChange={(val) => updateRow(record.ip_address, 'os_type', val)}
          >
            {OS_OPTIONS.map((o) => (
              <Select.Option key={o} value={o}>{o}</Select.Option>
            ))}
          </Select>
        ),
      },
    ];

    // Show open ports only for deep scan results
    if (mode === 'deep') {
      cols.push({
        title: 'Open Ports',
        dataIndex: 'open_ports',
        key: 'open_ports',
        render: (ports: number[]) =>
          ports.length === 0 ? (
            <Typography.Text type="secondary">—</Typography.Text>
          ) : (
            <Tooltip title={ports.join(', ')}>
              <Space size={2} wrap>
                {ports.slice(0, 6).map((p) => (
                  <Tag key={p} style={{ fontSize: 11, padding: '0 4px', marginBottom: 2 }}>
                    {p}
                  </Tag>
                ))}
                {ports.length > 6 && (
                  <Tag style={{ fontSize: 11, padding: '0 4px' }}>+{ports.length - 6}</Tag>
                )}
              </Space>
            </Tooltip>
          ),
      });
    }

    if (isUnmatched) {
      cols.push({
        title: 'Assign Subnet',
        key: 'assign_subnet',
        width: 260,
        render: (_: unknown, record: ScanRow) => (
          <Select
            size="small"
            placeholder="Select or create subnet…"
            style={{ width: 240 }}
            onChange={(val: string) => {
              if (val === '__create__') {
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
                    padding: '6px 12px',
                    cursor: 'pointer',
                    color: '#1677ff',
                    borderTop: '1px solid #f0f0f0',
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
        title: 'Status',
        key: 'status',
        width: 100,
        render: () => <Tag color="orange">Reserved</Tag>,
      });
    }

    return cols;
  };

  const selectedModeInfo = SCAN_MODES.find((m) => m.key === mode)!;

  // ── Infrastructure Scan state ────────────────────────────────────────────────
  const [infraCidrs, setInfraCidrs] = useState('');
  const [infraMode, setInfraMode] = useState<ScanMode>('standard');
  const [infraSaveInactive, setInfraSaveInactive] = useState(false);
  const [infraOverwrite, setInfraOverwrite] = useState(false);
  const [infraScanning, setInfraScanning] = useState(false);
  const [infraResult, setInfraResult] = useState<DiscoverScanResult | null>(null);

  const handleInfraScan = useCallback(async (): Promise<void> => {
    const cidrs = infraCidrs
      .split(/[\n,]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (cidrs.length === 0) {
      void message.warning('Enter at least one CIDR');
      return;
    }
    setInfraScanning(true);
    setInfraResult(null);
    try {
      const res = await scanApi.discover({
        cidrs,
        mode: infraMode,
        save_inactive: infraSaveInactive,
        overwrite_status: infraOverwrite,
      });
      setInfraResult(res.data);
      void message.success(
        `Scan complete: ${res.data.created} new, ${res.data.updated} updated, ${res.data.skipped} skipped`
      );
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      void message.error(axiosErr.response?.data?.detail ?? 'Infrastructure scan failed');
    } finally {
      setInfraScanning(false);
    }
  }, [infraCidrs, infraMode, infraSaveInactive, infraOverwrite]);

  const infraModeInfo = SCAN_MODES.find((m) => m.key === infraMode)!;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <WifiOutlined style={{ marginRight: 8 }} />
          Network Scanner
        </Typography.Title>
      </div>

      <Tabs defaultActiveKey="discovery">
        {/* ── Host Discovery tab ─────────────────────────────────────────── */}
        <Tabs.TabPane
          key="discovery"
          tab={<Space><WifiOutlined />Host Discovery</Space>}
        >
          {/* Scan mode selector */}
          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
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
                      setRows([]);
                      setScanInfo(null);
                    }}
                  />
                </Col>
              ))}
            </Row>
          </div>

          {/* CIDR input + scan button */}
          <Card size="small" style={{ marginBottom: 20 }}>
            <Row gutter={12} align="middle">
              <Col>
                <Typography.Text strong>Network CIDR:</Typography.Text>
              </Col>
              <Col flex="auto">
                <Input
                  value={cidr}
                  onChange={(e) => setCidr(e.target.value)}
                  onPressEnter={() => void handleScan()}
                  placeholder={`e.g. 192.168.1.0/24   (max ${selectedModeInfo.maxCidr} for ${selectedModeInfo.label} scan)`}
                  style={{ maxWidth: 340 }}
                  allowClear
                />
              </Col>
              <Col>
                <Button
                  type="primary"
                  icon={<ScanOutlined />}
                  loading={scanning}
                  disabled={!cidr.trim()}
                  onClick={() => void handleScan()}
                  style={{ background: selectedModeInfo.color, borderColor: selectedModeInfo.color }}
                >
                  {scanning ? 'Scanning…' : `${selectedModeInfo.label} Scan`}
                </Button>
              </Col>
            </Row>
          </Card>

          {scanning && (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12 }}>
                <Typography.Text type="secondary">
                  Running <strong>{selectedModeInfo.label}</strong> scan on {cidr.trim()}…
                </Typography.Text>
              </div>
            </div>
          )}

          {!scanning && scanInfo && (
            <>
              <Alert
                type={scanInfo.found > 0 ? 'success' : 'info'}
                message={
                  <span>
                    <Tag color={selectedModeInfo.color}>{scanInfo.mode.toUpperCase()} SCAN</Tag>{' '}
                    <Typography.Text code>{scanInfo.cidr}</Typography.Text> — found{' '}
                    <strong>{scanInfo.found}</strong> live host{scanInfo.found !== 1 ? 's' : ''} out of{' '}
                    <strong>{scanInfo.total}</strong> in <strong>{scanInfo.duration}s</strong>.
                    {rows.filter((r) => r.subnet_id === null).length > 0 && (
                      <span style={{ color: '#faad14', marginLeft: 8 }}>
                        {rows.filter((r) => r.subnet_id === null).length} host(s) have no matching subnet.
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
                    const allSelected = groupKeys.length > 0 && groupKeys.every((k) => selectedKeys.includes(k));
                    const someSelected = groupKeys.some((k) => selectedKeys.includes(k));
                    return (
                      <div key={group.subnet?.id ?? '__unmatched__'} style={{ marginBottom: 24 }}>
                        <Divider orientation="left" style={{ marginTop: idx === 0 ? 0 : undefined }}>
                          {isUnmatched ? (
                            <Space>
                              <WarningOutlined style={{ color: '#faad14' }} />
                              <Typography.Text type="warning">
                                No matching subnet — {group.rows.length} host{group.rows.length !== 1 ? 's' : ''}
                                &nbsp;(create subnets first to import)
                              </Typography.Text>
                            </Space>
                          ) : (
                            <Space>
                              <Typography.Text code>{group.subnet!.cidr}</Typography.Text>
                              <Typography.Text strong>{group.subnet!.name}</Typography.Text>
                              <Tag color="blue">{group.rows.length} host{group.rows.length !== 1 ? 's' : ''}</Tag>
                            </Space>
                          )}
                        </Divider>
                        {!isUnmatched && (
                          <div style={{ marginBottom: 6 }}>
                            <Checkbox
                              indeterminate={someSelected && !allSelected}
                              checked={allSelected}
                              onChange={() => toggleGroupSelection(group.rows, allSelected)}
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
                          scroll={{ x: mode === 'deep' ? 900 : 700 }}
                          rowSelection={
                            isUnmatched
                              ? undefined
                              : {
                                  selectedRowKeys: selectedKeys,
                                  onChange: (keys) =>
                                    setSelectedKeys((prev) => {
                                      const others = prev.filter((k) => !groupKeys.includes(k));
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

          <CreateSubnetModal
            open={createModal.open}
            suggestedCidr={createModal.suggestedCidr}
            onCreated={handleSubnetCreated}
            onCancel={() => setCreateModal({ open: false, forIp: '', suggestedCidr: '' })}
          />
        </Tabs.TabPane>

        {/* ── Infrastructure Scan tab ────────────────────────────────────── */}
        <Tabs.TabPane
          key="infrastructure"
          tab={<Space><DatabaseOutlined />Infrastructure Scan</Space>}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Infrastructure Scan — saves results directly to the database"
            description="Scan one or more CIDRs. Discovered (active) hosts are stored as 'In Use'. Optionally store non-responding IPs as 'Free' (Available). IPs without a matching subnet in your database are skipped."
          />

          {/* Mode selector */}
          <Row gutter={12} style={{ marginBottom: 16 }}>
            {SCAN_MODES.map((info) => (
              <Col xs={24} sm={8} key={info.key}>
                <ModeCard
                  info={info}
                  selected={infraMode === info.key}
                  onClick={() => setInfraMode(info.key)}
                />
              </Col>
            ))}
          </Row>

          {/* CIDR input + options */}
          <Card size="small" style={{ marginBottom: 16 }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={14}>
                <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                  CIDRs to scan (one per line or comma-separated):
                </Typography.Text>
                <Input.TextArea
                  rows={5}
                  value={infraCidrs}
                  onChange={(e) => setInfraCidrs(e.target.value)}
                  placeholder={'10.0.0.0/24\n192.168.1.0/24\n172.16.0.0/24'}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
              </Col>
              <Col xs={24} md={10}>
                <Space direction="vertical" size={16} style={{ width: '100%', paddingTop: 24 }}>
                  <Space align="start">
                    <Switch
                      checked={infraSaveInactive}
                      onChange={setInfraSaveInactive}
                      size="small"
                    />
                    <Typography.Text>
                      Store non-responding IPs as <Tag color="green">Free</Tag>
                    </Typography.Text>
                  </Space>
                  <Space align="start">
                    <Switch
                      checked={infraOverwrite}
                      onChange={setInfraOverwrite}
                      size="small"
                    />
                    <Typography.Text>
                      Overwrite existing record status
                    </Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    IPs with no matching subnet are skipped. Add subnets first in the Subnets page.
                  </Typography.Text>
                </Space>
              </Col>
            </Row>
          </Card>

          <Button
            type="primary"
            icon={<ScanOutlined />}
            loading={infraScanning}
            disabled={!infraCidrs.trim()}
            onClick={() => void handleInfraScan()}
            style={{ background: infraModeInfo.color, borderColor: infraModeInfo.color, marginBottom: 16 }}
          >
            {infraScanning ? 'Scanning infrastructure…' : `Run ${infraModeInfo.label} Infrastructure Scan`}
          </Button>

          {infraScanning && (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12 }}>
                <Typography.Text type="secondary">Scanning and saving to database…</Typography.Text>
              </div>
            </div>
          )}

          {!infraScanning && infraResult && (
            <Alert
              type={infraResult.errors.length > 0 ? 'warning' : 'success'}
              showIcon
              message={
                <Space wrap>
                  <span>Done in <strong>{infraResult.duration_seconds}s</strong></span>
                  <Tag color="blue">Scanned: {infraResult.total_scanned}</Tag>
                  <Tag color="green">Active: {infraResult.total_discovered}</Tag>
                  <Tag color="cyan">Created: {infraResult.created}</Tag>
                  <Tag color="purple">Updated: {infraResult.updated}</Tag>
                  <Tag color="default">Skipped: {infraResult.skipped}</Tag>
                </Space>
              }
              description={
                infraResult.errors.length > 0 ? (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>{infraResult.errors.length} error(s)</summary>
                    <ul style={{ margin: '8px 0 0 0', paddingLeft: 16 }}>
                      {infraResult.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                      {infraResult.errors.length > 20 && <li>…and {infraResult.errors.length - 20} more</li>}
                    </ul>
                  </details>
                ) : undefined
              }
            />
          )}
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default NetworkScanPage;

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Row,
  Col,
  message,
  Popconfirm,
  Typography,
  Progress,
  Tag,
  Tooltip,
  Radio,
  Dropdown,
} from "antd";
import type { MenuProps } from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  RightOutlined,
  WarningOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { subnetsApi } from "../../api/subnets";
import { vrfsApi } from "../../api/vrfs";
import { paloaltoScanSubnetStream } from "../../api/integrations";
import type { PaloAltoScanSubnetResult } from "../../types/integrations";
import { useAuth } from "../../context/AuthContext";
import type {
  SubnetCreate,
  SubnetDetail,
  SubnetTreeNode,
  SubnetUpdate,
} from "../../types/subnet";
import type { Environment } from "../../types/ipRecord";
import type { VRF } from "../../types/vrf";
import SubnetDetailDrawer from "./SubnetDetailDrawer";
import { ENV_OPTIONS, ENV_COLOR } from "../../constants/environments";

function stripEmptyChildren(nodes: SubnetTreeNode[]): SubnetTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    children:
      node.children.length > 0
        ? stripEmptyChildren(node.children)
        : (undefined as unknown as SubnetTreeNode[]),
  }));
}

// Client-side filter — the whole tree is already fetched in full (no
// pagination), so filtering here is instant and avoids a backend round trip.
// Keeps ancestors of any match visible so the tree stays navigable.
function filterTree(nodes: SubnetTreeNode[], term: string): SubnetTreeNode[] {
  const lower = term.toLowerCase();
  const result: SubnetTreeNode[] = [];
  for (const node of nodes) {
    const filteredChildren = node.children?.length
      ? filterTree(node.children, term)
      : [];
    const selfMatches =
      node.cidr.toLowerCase().includes(lower) ||
      node.name.toLowerCase().includes(lower) ||
      (node.description ?? "").toLowerCase().includes(lower);
    if (selfMatches || filteredChildren.length > 0) {
      result.push({ ...node, children: filteredChildren });
    }
  }
  return result;
}

function collectExpandableIds(nodes: SubnetTreeNode[]): string[] {
  let ids: string[] = [];
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      ids.push(node.id);
      ids = ids.concat(collectExpandableIds(node.children));
    }
  }
  return ids;
}

const SubnetsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const [tree, setTree] = useState<SubnetTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [vrfs, setVrfs] = useState<VRF[]>([]);
  const [filterVrf, setFilterVrf] = useState<string | undefined>(undefined);
  const [filterEnv, setFilterEnv] = useState<Environment | undefined>(
    undefined,
  );
  const [searchText, setSearchText] = useState("");
  const [manualExpandedKeys, setManualExpandedKeys] = useState<React.Key[]>([]);

  const [drawerSubnet, setDrawerSubnet] = useState<SubnetDetail | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSubnet, setEditingSubnet] = useState<SubnetTreeNode | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<SubnetCreate & SubnetUpdate>();

  const fetchTree = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const params: { vrf_id?: string; environment?: string } = {};
      if (filterVrf) params.vrf_id = filterVrf;
      if (filterEnv) params.environment = filterEnv;
      const res = await subnetsApi.tree(params);
      setTree(res.data);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      message.error(
        axiosErr.response?.data?.detail ??
          axiosErr.message ??
          "Failed to load subnets",
      );
    } finally {
      setLoading(false);
    }
  }, [filterVrf, filterEnv]);

  const fetchVrfs = useCallback(async (): Promise<void> => {
    try {
      const res = await vrfsApi.list({ page_size: 200 });
      setVrfs(res.data.items);
    } catch {
      // Non-critical
    }
  }, []);

  const [scanningSubnetId, setScanningSubnetId] = useState<string | null>(null);
  const [scanModal, setScanModal] = useState<{
    open: boolean;
    cidr: string;
    log: string[];
    done: number;
    total: number;
    found: number;
    summary: PaloAltoScanSubnetResult | null;
    error: string | null;
  }>({
    open: false,
    cidr: "",
    log: [],
    done: 0,
    total: 0,
    found: 0,
    summary: null,
    error: null,
  });
  const scanLogRef = useRef<HTMLDivElement>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scanLogRef.current) {
      scanLogRef.current.scrollTop = scanLogRef.current.scrollHeight;
    }
  }, [scanModal.log]);

  const handleScanSubnet = useCallback(
    async (record: SubnetTreeNode): Promise<void> => {
      const prefix = Number(record.cidr.split("/")[1]);
      const total = Number.isFinite(prefix)
        ? Math.max(0, 2 ** (32 - prefix) - 2)
        : 0;

      scanAbortRef.current?.abort();
      const controller = new AbortController();
      scanAbortRef.current = controller;

      setScanningSubnetId(record.id);
      setScanModal({
        open: true,
        cidr: record.cidr,
        log: [],
        done: 0,
        total,
        found: 0,
        summary: null,
        error: null,
      });

      try {
        await paloaltoScanSubnetStream(
          record.id,
          {
            onLog: (ip, line) =>
              setScanModal((prev) => ({
                ...prev,
                log: [...prev.log, `[${ip}] ${line}`],
              })),
            onResult: (result) =>
              setScanModal((prev) => ({
                ...prev,
                done: prev.done + 1,
                found: prev.found + (result.found ? 1 : 0),
              })),
            onSummary: (summary) =>
              setScanModal((prev) => ({ ...prev, summary })),
            onError: (message) =>
              setScanModal((prev) => ({ ...prev, error: message })),
          },
          controller.signal,
        );
        void fetchTree();
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        const error = err as Error;
        setScanModal((prev) => ({
          ...prev,
          error: error.message || "PaloAlto scan failed",
        }));
      } finally {
        if (scanAbortRef.current === controller) {
          setScanningSubnetId(null);
        }
      }
    },
    [fetchTree],
  );

  useEffect(() => {
    void fetchVrfs();
  }, [fetchVrfs]);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  const openCreate = useCallback((): void => {
    setEditingSubnet(null);
    form.resetFields();
    setModalOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (subnet: SubnetTreeNode): void => {
      setEditingSubnet(subnet);
      form.setFieldsValue({
        cidr: subnet.cidr,
        name: subnet.name,
        description: subnet.description ?? undefined,
        gateway: subnet.gateway ?? undefined,
        vlan_id: subnet.vlan_id ?? undefined,
        environment: subnet.environment,
        vrf_id: subnet.vrf_id ?? undefined,
        alert_threshold: subnet.alert_threshold ?? undefined,
        ip_version: subnet.ip_version ?? 4,
      });
      setModalOpen(true);
    },
    [form],
  );

  const handleSubmit = useCallback(
    async (values: SubnetCreate & SubnetUpdate): Promise<void> => {
      setSubmitting(true);
      try {
        if (editingSubnet) {
          const update: SubnetUpdate = {
            name: values.name,
            description: values.description,
            gateway: values.gateway,
            vlan_id: values.vlan_id,
            environment: values.environment,
            vrf_id: values.vrf_id,
            alert_threshold: values.alert_threshold,
          };
          await subnetsApi.update(editingSubnet.id, update);
          message.success("Subnet updated");
        } else {
          const create: SubnetCreate = {
            cidr: values.cidr!,
            name: values.name!,
            description: values.description,
            gateway: values.gateway,
            vlan_id: values.vlan_id,
            environment: values.environment!,
            vrf_id: values.vrf_id,
            alert_threshold: values.alert_threshold,
            ip_version: values.ip_version ?? 4,
          };
          await subnetsApi.create(create);
          message.success("Subnet created");
        }
        setModalOpen(false);
        form.resetFields();
        void fetchTree();
      } catch (err: unknown) {
        const axiosErr = err as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        message.error(
          axiosErr.response?.data?.detail ??
            axiosErr.message ??
            "Operation failed",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [editingSubnet, fetchTree, form],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        await subnetsApi.delete(id);
        message.success("Subnet deleted");
        void fetchTree();
      } catch (err: unknown) {
        const axiosErr = err as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        message.error(
          axiosErr.response?.data?.detail ??
            axiosErr.message ??
            "Delete failed",
        );
      }
    },
    [fetchTree],
  );

  const columns: ColumnsType<SubnetTreeNode> = [
    {
      title: "CIDR",
      dataIndex: "cidr",
      key: "cidr",
      width: 220,
      render: (v: string, record: SubnetTreeNode) => {
        const overThreshold =
          record.alert_threshold !== null &&
          record.alert_threshold !== undefined &&
          record.utilization_pct >= record.alert_threshold;
        const ipv = record.ip_version ?? 4;
        const scanMenuItems: MenuProps["items"] = hasRole("Operator")
          ? [
              {
                key: "scan-paloalto",
                label:
                  scanningSubnetId === record.id
                    ? "Scanning…"
                    : "Scan in PaloAlto",
                icon: <SafetyCertificateOutlined />,
                disabled: record.is_container || scanningSubnetId === record.id,
                onClick: () => void handleScanSubnet(record),
              },
            ]
          : [];
        return (
          <Dropdown menu={{ items: scanMenuItems }} trigger={["contextMenu"]}>
            <span>
              {overThreshold && (
                <Tooltip
                  title={`Utilization ${record.utilization_pct}% ≥ threshold ${record.alert_threshold}%`}
                >
                  <WarningOutlined
                    style={{ color: "#ff4d4f", marginRight: 4 }}
                  />
                </Tooltip>
              )}
              <Tag
                color={ipv === 6 ? "purple" : "blue"}
                style={{ fontSize: 10, padding: "0 4px", marginRight: 4 }}
              >
                IPv{ipv}
              </Tag>
              <Tooltip
                title={
                  record.is_container
                    ? undefined
                    : "Right-click to scan in PaloAlto"
                }
              >
                <Typography.Text
                  code
                  style={{ cursor: "context-menu", color: "#1677ff" }}
                  onClick={() => setDrawerSubnet(record)}
                >
                  {v}
                </Typography.Text>
              </Tooltip>
            </span>
          </Dropdown>
        );
      },
    },
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (v: string, record: SubnetTreeNode) =>
        record.description ? (
          <Tooltip title={record.description}>{v}</Tooltip>
        ) : (
          v
        ),
    },
    {
      title: "VRF",
      dataIndex: "vrf_id",
      key: "vrf_id",
      width: 120,
      render: (v: string | null) => {
        if (!v)
          return <Typography.Text type="secondary">Global</Typography.Text>;
        const vrf = vrfs.find((x) => x.id === v);
        return vrf ? <Tag>{vrf.name}</Tag> : <Tag>{v.slice(0, 8)}…</Tag>;
      },
    },
    {
      title: "Environment",
      dataIndex: "environment",
      key: "environment",
      width: 120,
      render: (v: Environment) => <Tag color={ENV_COLOR[v]}>{v}</Tag>,
    },
    {
      title: "VLAN",
      dataIndex: "vlan_id",
      key: "vlan_id",
      width: 72,
      render: (v: number | null) =>
        v != null ? v : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: "Gateway",
      dataIndex: "gateway",
      key: "gateway",
      width: 140,
      render: (v: string | null) =>
        v ? (
          <Typography.Text code>{v}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Utilization",
      key: "utilization",
      width: 220,
      render: (_, record) => {
        const pct = record.utilization_pct;
        const strokeColor =
          pct >= 90 ? "#ff4d4f" : pct >= 70 ? "#faad14" : "#52c41a";
        const label = record.is_container
          ? `${record.used_ips.toLocaleString()} / ${record.total_ips.toLocaleString()} IPs allocated`
          : `${record.used_ips} / ${record.total_ips} in use`;
        return (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 2,
                fontSize: 12,
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {record.is_container ? (
                  <>
                    <RightOutlined style={{ fontSize: 9, marginRight: 2 }} />
                    {record.child_prefix_count} child prefix
                    {record.child_prefix_count !== 1 ? "es" : ""}
                  </>
                ) : (
                  label
                )}
              </Typography.Text>
              <Typography.Text style={{ color: strokeColor, fontSize: 11 }}>
                {pct}%
              </Typography.Text>
            </div>
            <Progress
              percent={pct}
              showInfo={false}
              strokeColor={strokeColor}
              size="small"
            />
          </div>
        );
      },
    },
    ...(hasRole("Administrator")
      ? ([
          {
            title: "Actions",
            key: "actions",
            width: 100,
            render: (_: unknown, record: SubnetTreeNode) => (
              <Space size={4}>
                <Tooltip title="Edit">
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEdit(record)}
                  />
                </Tooltip>
                {hasRole("Administrator") && (
                  <Popconfirm
                    title="Delete this subnet?"
                    description={
                      record.is_container
                        ? "This subnet has children — delete them first."
                        : "This will only succeed if no IP records are assigned."
                    }
                    onConfirm={() => void handleDelete(record.id)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    disabled={record.is_container}
                  >
                    <Tooltip
                      title={
                        record.is_container ? "Delete children first" : "Delete"
                      }
                    >
                      <Button
                        size="small"
                        icon={<DeleteOutlined />}
                        danger
                        disabled={record.is_container}
                      />
                    </Tooltip>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ] as ColumnsType<SubnetTreeNode>)
      : []),
  ];

  const isSearching = searchText.trim().length > 0;
  const filteredTree = useMemo(
    () => (isSearching ? filterTree(tree, searchText.trim()) : tree),
    [tree, isSearching, searchText],
  );
  const displayTree = useMemo(
    () => stripEmptyChildren(filteredTree),
    [filteredTree],
  );
  const expandedRowKeys = isSearching
    ? collectExpandableIds(filteredTree)
    : manualExpandedKeys;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          Subnets
        </Typography.Title>
        <Space wrap>
          <Input.Search
            placeholder="Search CIDR / name / description"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            prefix={<SearchOutlined />}
            style={{ width: 240 }}
          />
          <Select
            placeholder="All VRFs"
            allowClear
            style={{ width: 160 }}
            value={filterVrf}
            onChange={(v) => setFilterVrf(v)}
            options={[
              { value: "", label: "Global (no VRF)" },
              ...vrfs.map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
          <Select
            placeholder="All Environments"
            allowClear
            style={{ width: 160 }}
            value={filterEnv}
            onChange={(v) => setFilterEnv(v as Environment | undefined)}
            options={ENV_OPTIONS.map((e) => ({ value: e, label: e }))}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void fetchTree()}
            loading={loading}
          >
            Refresh
          </Button>
          {hasRole("Administrator") && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Create Subnet
            </Button>
          )}
        </Space>
      </div>

      <Table<SubnetTreeNode>
        dataSource={displayTree}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1000 }}
        pagination={false}
        size="small"
        locale={{
          emptyText: isSearching
            ? `No subnets match "${searchText.trim()}"`
            : "No subnets",
        }}
        expandable={{
          childrenColumnName: "children",
          expandedRowKeys,
          onExpandedRowsChange: (keys) => {
            if (!isSearching) setManualExpandedKeys(keys as React.Key[]);
          },
          rowExpandable: (record) => (record.children?.length ?? 0) > 0,
        }}
      />

      {/* Subnet Detail Drawer */}
      <SubnetDetailDrawer
        subnet={drawerSubnet}
        onClose={() => setDrawerSubnet(null)}
      />

      {/* PaloAlto Scan Progress Modal */}
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: "#1677ff" }} />
            Scanning {scanModal.cidr} in PaloAlto
          </Space>
        }
        open={scanModal.open}
        onCancel={() => setScanModal((prev) => ({ ...prev, open: false }))}
        footer={
          <Button
            onClick={() => setScanModal((prev) => ({ ...prev, open: false }))}
          >
            Close
          </Button>
        }
        width={640}
      >
        <Progress
          percent={
            scanModal.total > 0
              ? Math.round((scanModal.done / scanModal.total) * 100)
              : 0
          }
          status={
            scanModal.error
              ? "exception"
              : scanModal.summary
                ? "success"
                : "active"
          }
          style={{ marginBottom: 8 }}
        />
        <Typography.Text
          type="secondary"
          style={{ display: "block", marginBottom: 12 }}
        >
          {scanModal.summary
            ? `Done — ${scanModal.done} of ${scanModal.total || scanModal.done} scanned, ${scanModal.found} in use`
            : `${scanModal.done} of ${scanModal.total || "?"} scanned, ${scanModal.found} in use so far…`}
        </Typography.Text>

        {scanModal.error && (
          <Typography.Text
            type="danger"
            style={{ display: "block", marginBottom: 12 }}
          >
            {scanModal.error}
          </Typography.Text>
        )}

        <div
          ref={scanLogRef}
          style={{
            background: "#0b0f14",
            color: "#8ce68c",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.6,
            padding: "10px 14px",
            borderRadius: 4,
            maxHeight: 260,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            marginBottom: scanModal.summary ? 12 : 0,
          }}
        >
          {scanModal.log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>

        {scanModal.summary && (
          <>
            <Typography.Text strong>
              {scanModal.summary.created} new · {scanModal.summary.updated}{" "}
              updated · {scanModal.summary.skipped} unused · utilization now{" "}
              {scanModal.summary.utilization_pct}%
              {scanModal.summary.errors.length > 0 &&
                ` · ${scanModal.summary.errors[0]}`}
            </Typography.Text>

            {scanModal.summary.top_rules.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, display: "block", marginBottom: 6 }}
                >
                  Top rules referencing addresses in this subnet:
                </Typography.Text>
                <Space size={[6, 6]} wrap>
                  {scanModal.summary.top_rules.map((r) => (
                    <Tag
                      key={`${r.rule_type}-${r.rule_name}`}
                      color={r.rule_type === "nat" ? "gold" : "blue"}
                    >
                      {r.rule_name} · {r.hit_count}{" "}
                      {r.rule_type === "nat" ? "(NAT)" : "(security)"}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
          </>
        )}
      </Modal>

      {/* Create / Edit Modal */}
      <Modal
        title={editingSubnet ? "Edit Subnet" : "Create Subnet"}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={editingSubnet ? "Save" : "Create"}
        confirmLoading={submitting}
        width={520}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => void handleSubmit(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item label="IP Version" name="ip_version" initialValue={4}>
            <Radio.Group disabled={!!editingSubnet} buttonStyle="solid">
              <Radio.Button value={4}>IPv4</Radio.Button>
              <Radio.Button value={6}>IPv6</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            label="CIDR"
            name="cidr"
            rules={[
              { required: true, message: "CIDR is required" },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
                  const ipv6Re = /^[0-9a-fA-F:]+\/\d{1,3}$/;
                  if (ipv4Re.test(value) || ipv6Re.test(value))
                    return Promise.resolve();
                  return Promise.reject(
                    new Error(
                      "Enter a valid CIDR (e.g. 192.168.1.0/24 or 2001:db8::/48)",
                    ),
                  );
                },
              },
            ]}
          >
            <Input
              placeholder="192.168.1.0/24 or 2001:db8::/48"
              disabled={!!editingSubnet}
            />
          </Form.Item>

          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Name is required" }]}
          >
            <Input placeholder="Office LAN" />
          </Form.Item>

          <Form.Item
            label="Environment"
            name="environment"
            rules={[{ required: true, message: "Environment is required" }]}
          >
            <Select
              options={ENV_OPTIONS.map((e) => ({ value: e, label: e }))}
            />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="VRF" name="vrf_id">
                <Select
                  placeholder="Global (no VRF)"
                  allowClear
                  options={vrfs.map((v) => ({ value: v.id, label: v.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="VLAN ID" name="vlan_id">
                <InputNumber
                  min={1}
                  max={4094}
                  style={{ width: "100%" }}
                  placeholder="100"
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Gateway" name="gateway">
                <Input placeholder="192.168.1.1" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Alert Threshold %"
                name="alert_threshold"
                tooltip="Trigger alert when utilization reaches this percentage"
              >
                <InputNumber
                  min={1}
                  max={100}
                  style={{ width: "100%" }}
                  placeholder="e.g. 80"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SubnetsPage;

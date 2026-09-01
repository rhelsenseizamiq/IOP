import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Typography,
  Table,
  Button,
  Space,
  Tag,
  Alert,
  Input,
  Progress,
  Card,
  Row,
  Col,
  Statistic,
  Empty,
  Pagination,
} from "antd";
import {
  PlusOutlined,
  ArrowLeftOutlined,
  SearchOutlined,
  WifiOutlined,
  InboxOutlined,
  DatabaseOutlined,
  RiseOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { subnetsApi } from "../../api/subnets";
import { useAuth } from "../../context/AuthContext";
import type { SubnetDetail } from "../../types/subnet";
import { ENV_COLOR } from "../../constants/environments";
import CheckAvailabilityModal from "../../components/common/CheckAvailabilityModal";

const DETAIL_PAGE_SIZE = 50;
const SUBNET_FETCH_PAGE_SIZE = 200; // server-enforced max

interface SubnetRow extends SubnetDetail {
  unused: number;
}

/** Fetches every subnet regardless of count, looping past the server's
 * per-request page_size cap (200) — a single oversized request 422s and
 * was previously swallowed silently, which is why this page looked empty. */
async function fetchAllSubnets(): Promise<SubnetDetail[]> {
  const all: SubnetDetail[] = [];
  let page = 1;
  for (;;) {
    const res = await subnetsApi.list({
      page,
      page_size: SUBNET_FETCH_PAGE_SIZE,
    });
    all.push(...res.data.items);
    if (all.length >= res.data.total || res.data.items.length === 0) break;
    page += 1;
  }
  return all;
}

const UnusedIPsPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [subnets, setSubnets] = useState<SubnetDetail[]>([]);
  const [subnetsLoading, setSubnetsLoading] = useState(true);
  const [subnetsError, setSubnetsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cardPage, setCardPage] = useState(1);
  const CARD_PAGE_SIZE = 12;

  const [selectedSubnetId, setSelectedSubnetId] = useState<string | undefined>(
    searchParams.get("subnet_id") ?? undefined,
  );
  const [items, setItems] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [capped, setCapped] = useState(false);
  const [page, setPage] = useState(1);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSearch, setDetailSearch] = useState("");
  const [checkAvailIp, setCheckAvailIp] = useState<string | null>(null);

  useEffect(() => {
    setSubnetsLoading(true);
    setSubnetsError(null);
    fetchAllSubnets()
      .then((all) => setSubnets(all))
      .catch((err: unknown) => {
        const axiosErr = err as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        setSubnetsError(
          axiosErr.response?.data?.detail ??
            axiosErr.message ??
            "Failed to load subnets",
        );
        setSubnets([]);
      })
      .finally(() => setSubnetsLoading(false));
  }, []);

  const fetchUnused = useCallback(
    async (subnetId: string, pageNum: number, q: string): Promise<void> => {
      setDetailLoading(true);
      try {
        const res = await subnetsApi.unusedIps(
          subnetId,
          pageNum,
          DETAIL_PAGE_SIZE,
          q,
        );
        setItems(res.data.items);
        setTotal(res.data.total);
        setCapped(res.data.capped);
      } catch {
        setItems([]);
        setTotal(0);
      } finally {
        setDetailLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedSubnetId) {
      void fetchUnused(selectedSubnetId, page, detailSearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubnetId, page, fetchUnused]);

  // Debounce the detail search so we're not firing a request per keystroke
  useEffect(() => {
    if (!selectedSubnetId) return;
    const handle = setTimeout(() => {
      setPage(1);
      void fetchUnused(selectedSubnetId, 1, detailSearch);
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailSearch]);

  const openSubnet = (id: string): void => {
    setSelectedSubnetId(id);
    setPage(1);
    setDetailSearch("");
    setSearchParams({ subnet_id: id });
  };

  const backToSummary = (): void => {
    setSelectedSubnetId(undefined);
    setItems([]);
    setTotal(0);
    setDetailSearch("");
    setSearchParams({});
  };

  // Every address in the subnet's CIDR that has no IP record of any status
  // at all (Device42-sourced or not — this counts every subnet the same way).
  const subnetRows: SubnetRow[] = useMemo(
    () =>
      subnets.map((s) => ({
        ...s,
        unused: Math.max(
          0,
          s.total_ips - s.used_ips - s.free_ips - s.reserved_ips,
        ),
      })),
    [subnets],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? subnetRows.filter(
          (s) =>
            s.cidr.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q),
        )
      : subnetRows;
    return [...rows].sort((a, b) => b.unused - a.unused);
  }, [subnetRows, search]);

  // Reset back to page 1 whenever the search term changes
  useEffect(() => {
    setCardPage(1);
  }, [search]);

  const totalUnusedAcrossAll = useMemo(
    () => subnetRows.reduce((sum, s) => sum + s.unused, 0),
    [subnetRows],
  );

  const subnetsWithRoomCount = useMemo(
    () => subnetRows.filter((s) => s.unused > 0).length,
    [subnetRows],
  );

  const roomiestSubnet = useMemo(
    () =>
      subnetRows.length
        ? subnetRows.reduce((best, s) => (s.unused > best.unused ? s : best))
        : null,
    [subnetRows],
  );

  const pagedCards = useMemo(
    () =>
      filteredRows.slice(
        (cardPage - 1) * CARD_PAGE_SIZE,
        cardPage * CARD_PAGE_SIZE,
      ),
    [filteredRows, cardPage],
  );

  const selectedSubnet = subnets.find((s) => s.id === selectedSubnetId);

  const detailColumns: ColumnsType<string> = [
    {
      title: "IP Address",
      dataIndex: "ip",
      key: "ip",
      render: (_: unknown, ip: string) => (
        <Typography.Text code>{ip}</Typography.Text>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 320,
      render: (_: unknown, ip: string) => {
        if (!hasRole("Administrator")) return null;
        return (
          <Space size={4}>
            <Button
              size="small"
              icon={<WifiOutlined />}
              onClick={() => setCheckAvailIp(ip)}
            >
              Check Availability
            </Button>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() =>
                navigate(
                  `/ip-records?open_create=1&subnet_id=${selectedSubnetId}&ip=${encodeURIComponent(ip)}`,
                )
              }
            >
              Create
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ margin: 0 }}>
        Unused IP Addresses
      </Typography.Title>

      <Typography.Paragraph type="secondary">
        See which addresses are free to hand out in each subnet — no network
        scanning involved, just what's already recorded (or not) in IPAM.
      </Typography.Paragraph>

      {subnetsError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Failed to load subnets"
          description={subnetsError}
        />
      )}

      {!selectedSubnetId ? (
        <>
          <Row gutter={16} style={{ marginBottom: 20 }}>
            <Col xs={24} sm={8}>
              <Card size="small">
                <Statistic
                  title="Addresses available"
                  value={totalUnusedAcrossAll}
                  valueStyle={{ color: "#52c41a" }}
                  prefix={<InboxOutlined />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small">
                <Statistic
                  title="Subnets with room"
                  value={subnetsWithRoomCount}
                  suffix={`/ ${subnetRows.length}`}
                  prefix={<DatabaseOutlined />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card
                size="small"
                hoverable={!!roomiestSubnet && roomiestSubnet.unused > 0}
                onClick={() =>
                  roomiestSubnet && roomiestSubnet.unused > 0
                    ? openSubnet(roomiestSubnet.id)
                    : undefined
                }
              >
                <Statistic
                  title="Most room to grow"
                  value={roomiestSubnet?.cidr ?? "—"}
                  prefix={<RiseOutlined />}
                  valueStyle={{ fontSize: 20 }}
                />
                {roomiestSubnet && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {roomiestSubnet.name} ·{" "}
                    {roomiestSubnet.unused.toLocaleString()} free
                  </Typography.Text>
                )}
              </Card>
            </Col>
          </Row>

          <Input
            allowClear
            size="large"
            prefix={<SearchOutlined />}
            placeholder="Search subnets by name or CIDR…"
            style={{ marginBottom: 20, maxWidth: 480 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {!subnetsLoading && filteredRows.length === 0 ? (
            <Empty description="No subnets match your search" />
          ) : (
            <>
              <Row gutter={[16, 16]}>
                {(subnetsLoading
                  ? Array.from<undefined>({ length: 6 })
                  : pagedCards
                ).map((row: SubnetRow | undefined, idx) => {
                  if (!row) {
                    return (
                      <Col xs={24} sm={12} lg={8} key={`skeleton-${idx}`}>
                        <Card size="small" loading />
                      </Col>
                    );
                  }
                  const pct =
                    row.total_ips > 0
                      ? Math.round(
                          ((row.total_ips - row.unused) / row.total_ips) * 100,
                        )
                      : 0;
                  const hasRoom = row.unused > 0;
                  return (
                    <Col xs={24} sm={12} lg={8} key={row.id}>
                      <Card
                        size="small"
                        hoverable={hasRoom}
                        onClick={() =>
                          hasRoom ? openSubnet(row.id) : undefined
                        }
                        style={{ height: "100%" }}
                      >
                        <Space
                          direction="vertical"
                          size={4}
                          style={{ width: "100%" }}
                        >
                          <Space
                            style={{
                              width: "100%",
                              justifyContent: "space-between",
                            }}
                          >
                            <Typography.Text code>{row.cidr}</Typography.Text>
                            <Tag color={ENV_COLOR[row.environment]}>
                              {row.environment}
                            </Tag>
                          </Space>
                          <Typography.Text
                            type="secondary"
                            ellipsis
                            style={{ display: "block" }}
                          >
                            {row.name}
                          </Typography.Text>

                          {hasRoom ? (
                            <Typography.Title
                              level={3}
                              style={{ margin: "8px 0 0", color: "#52c41a" }}
                            >
                              {row.unused.toLocaleString()}{" "}
                              <Typography.Text
                                type="secondary"
                                style={{ fontSize: 13, fontWeight: 400 }}
                              >
                                free
                              </Typography.Text>
                            </Typography.Title>
                          ) : (
                            <Typography.Text
                              type="secondary"
                              style={{ display: "block", margin: "8px 0 0" }}
                            >
                              Fully accounted for
                            </Typography.Text>
                          )}

                          <Progress
                            percent={pct}
                            size="small"
                            showInfo={false}
                            strokeColor={pct >= 90 ? "#faad14" : "#1677ff"}
                          />
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            {pct}% in use of {row.total_ips.toLocaleString()}{" "}
                            addresses
                          </Typography.Text>
                        </Space>
                      </Card>
                    </Col>
                  );
                })}
              </Row>

              {filteredRows.length > CARD_PAGE_SIZE && (
                <div style={{ textAlign: "center", marginTop: 20 }}>
                  <Pagination
                    current={cardPage}
                    pageSize={CARD_PAGE_SIZE}
                    total={filteredRows.length}
                    onChange={setCardPage}
                    showSizeChanger={false}
                  />
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <Space style={{ marginBottom: 16 }}>
            <Button icon={<ArrowLeftOutlined />} onClick={backToSummary}>
              Back
            </Button>
            {selectedSubnet && (
              <Typography.Text>
                <Typography.Text code>{selectedSubnet.cidr}</Typography.Text> —{" "}
                {selectedSubnet.name}
              </Typography.Text>
            )}
          </Space>

          {selectedSubnet && (
            <Space style={{ marginBottom: 16 }} size={16}>
              <span>
                <Typography.Text type="secondary">Size: </Typography.Text>
                <Typography.Text strong>
                  {selectedSubnet.total_ips.toLocaleString()} addresses
                </Typography.Text>
              </span>
              <span>
                <Typography.Text type="secondary">Available: </Typography.Text>
                <Typography.Text strong style={{ color: "#52c41a" }}>
                  {total.toLocaleString()}
                  {capped ? "+" : ""}
                </Typography.Text>
              </span>
              <Tag color={ENV_COLOR[selectedSubnet.environment]}>
                {selectedSubnet.environment}
              </Tag>
            </Space>
          )}

          {capped && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="This is a very large subnet — showing the first 65,536 addresses checked. The count above may be a bit higher in reality."
            />
          )}

          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Filter by IP address…"
            style={{ width: 280, marginBottom: 16 }}
            value={detailSearch}
            onChange={(e) => setDetailSearch(e.target.value)}
          />

          <Table<string>
            dataSource={items}
            columns={detailColumns}
            rowKey={(ip) => ip}
            loading={detailLoading}
            size="small"
            pagination={{
              current: page,
              pageSize: DETAIL_PAGE_SIZE,
              total,
              onChange: (p) => setPage(p),
              showSizeChanger: false,
            }}
            locale={{ emptyText: "No unused addresses in this subnet" }}
          />
        </>
      )}

      <CheckAvailabilityModal
        open={!!checkAvailIp}
        onClose={() => setCheckAvailIp(null)}
        ipAddress={checkAvailIp ?? ""}
        onUpdated={() => {
          if (selectedSubnetId)
            void fetchUnused(selectedSubnetId, page, detailSearch);
        }}
      />
    </div>
  );
};

export default UnusedIPsPage;

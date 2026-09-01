import React, { useEffect, useState, useCallback } from "react";
import {
  Card,
  Typography,
  Row,
  Col,
  Button,
  Space,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  BugOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FireOutlined,
  DashboardOutlined,
} from "@ant-design/icons";
import { subnetsApi } from "../../api/subnets";
import { useAuth } from "../../context/AuthContext";
import type { SubnetDetail } from "../../types/subnet";
import VSphereImportDrawer from "./VSphereImportDrawer";
import Device42ImportDrawer from "./Device42ImportDrawer";
import PaloAltoImportDrawer from "./PaloAltoImportDrawer";
import ZabbixImportDrawer from "./ZabbixImportDrawer";

const NO_ACCESS_TOOLTIP =
  "Only SuperAdmin can run this integration's discover/import — everyone else can view this page but not use it.";

const IntegrationsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const canUseIntegrations = hasRole("SuperAdmin");
  const [subnets, setSubnets] = useState<SubnetDetail[]>([]);
  const [vsphereOpen, setVsphereOpen] = useState(false);
  const [device42Open, setDevice42Open] = useState(false);
  const [paloaltoOpen, setPaloaltoOpen] = useState(false);
  const [zabbixOpen, setZabbixOpen] = useState(false);

  const fetchSubnets = useCallback(async (): Promise<void> => {
    try {
      let page = 1;
      let all: SubnetDetail[] = [];
      let total = 1;
      while (all.length < total) {
        const res = await subnetsApi.list({ page, page_size: 200 });
        all = [...all, ...res.data.items];
        total = res.data.total;
        if (res.data.items.length === 0) break;
        page += 1;
      }
      setSubnets(all);
    } catch {
      void message.error("Failed to load subnets");
    }
  }, []);

  useEffect(() => {
    void fetchSubnets();
  }, [fetchSubnets]);

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 24 }}>
        Integrations
      </Typography.Title>

      <Row gutter={[16, 16]}>
        {/* vSphere */}
        <Col xs={24} sm={12} lg={8}>
          <Card
            hoverable
            title={
              <Space>
                <CloudServerOutlined
                  style={{ color: "#1677ff", fontSize: 20 }}
                />
                <span>VMware vSphere</span>
              </Space>
            }
            extra={<Tag color="blue">VM Import</Tag>}
          >
            <Typography.Paragraph type="secondary" style={{ minHeight: 60 }}>
              Connect to vCenter and discover virtual machines. Select VMs to
              bulk-import their IP addresses as IPAM records.
            </Typography.Paragraph>
            <Tooltip title={canUseIntegrations ? undefined : NO_ACCESS_TOOLTIP}>
              <Button
                type="primary"
                icon={<CloudServerOutlined />}
                disabled={!canUseIntegrations}
                onClick={() => setVsphereOpen(true)}
              >
                Open vSphere Import
              </Button>
            </Tooltip>
          </Card>
        </Col>

        {/* Device42 */}
        <Col xs={24} sm={12} lg={8}>
          <Card
            hoverable
            title={
              <Space>
                <DatabaseOutlined style={{ color: "#722ed1", fontSize: 20 }} />
                <span>Device42</span>
              </Space>
            }
            extra={<Tag color="purple">IP Import</Tag>}
          >
            <Typography.Paragraph type="secondary" style={{ minHeight: 60 }}>
              Connect to Device42 DCIM and fetch all tracked IP addresses and
              devices. Select entries to bulk-import as IPAM records.
            </Typography.Paragraph>
            <Tooltip title={canUseIntegrations ? undefined : NO_ACCESS_TOOLTIP}>
              <Button
                type="primary"
                icon={<DatabaseOutlined />}
                style={{ background: "#722ed1", borderColor: "#722ed1" }}
                disabled={!canUseIntegrations}
                onClick={() => setDevice42Open(true)}
              >
                Open Device42 Import
              </Button>
            </Tooltip>
          </Card>
        </Col>

        {/* PaloAlto */}
        <Col xs={24} sm={12} lg={8}>
          <Card
            hoverable
            title={
              <Space>
                <FireOutlined style={{ color: "#f5222d", fontSize: 20 }} />
                <span>PaloAlto Firewall</span>
              </Space>
            }
            extra={<Tag color="red">FW Import</Tag>}
          >
            <Typography.Paragraph type="secondary" style={{ minHeight: 60 }}>
              Connect to PaloAlto firewall and collect address objects,
              interface IPs, and ARP table entries to import as IPAM records.
            </Typography.Paragraph>
            <Tooltip title={canUseIntegrations ? undefined : NO_ACCESS_TOOLTIP}>
              <Button
                danger
                type="primary"
                icon={<FireOutlined />}
                disabled={!canUseIntegrations}
                onClick={() => setPaloaltoOpen(true)}
              >
                Open PaloAlto Import
              </Button>
            </Tooltip>
          </Card>
        </Col>

        {/* Zabbix */}
        <Col xs={24} sm={12} lg={8}>
          <Card
            hoverable
            title={
              <Space>
                <DashboardOutlined style={{ color: "#d4380d", fontSize: 20 }} />
                <span>Zabbix</span>
              </Space>
            }
            extra={<Tag color="volcano">Live Monitoring</Tag>}
          >
            <Typography.Paragraph type="secondary" style={{ minHeight: 60 }}>
              Connect to Zabbix (already configured) and import monitored hosts.
              Also powers real-time availability checks — Zabbix actively polls
              these hosts, so results reflect live status.
            </Typography.Paragraph>
            <Tooltip title={canUseIntegrations ? undefined : NO_ACCESS_TOOLTIP}>
              <Button
                type="primary"
                icon={<DashboardOutlined />}
                style={{ background: "#d4380d", borderColor: "#d4380d" }}
                disabled={!canUseIntegrations}
                onClick={() => setZabbixOpen(true)}
              >
                Open Zabbix Import
              </Button>
            </Tooltip>
          </Card>
        </Col>

        {/* DNS Scan */}
        <Col xs={24} sm={12} lg={8}>
          <Card
            title={
              <Space>
                <BugOutlined style={{ color: "#52c41a", fontSize: 20 }} />
                <span>DNS Conflict Detection</span>
              </Space>
            }
            extra={<Tag color="green">Per-Subnet</Tag>}
          >
            <Typography.Paragraph type="secondary" style={{ minHeight: 60 }}>
              Detect forward/PTR mismatches and duplicate hostnames. Available
              per-subnet via the{" "}
              <Typography.Text strong>Scan Conflicts</Typography.Text> button in
              the Subnets page.
            </Typography.Paragraph>
            <Button href="/subnets" icon={<BugOutlined />}>
              Go to Subnets
            </Button>
          </Card>
        </Col>
      </Row>

      <VSphereImportDrawer
        open={vsphereOpen}
        subnets={subnets}
        onClose={() => {
          setVsphereOpen(false);
          void fetchSubnets();
        }}
      />
      <Device42ImportDrawer
        open={device42Open}
        subnets={subnets}
        onClose={() => {
          setDevice42Open(false);
          void fetchSubnets();
        }}
      />
      <PaloAltoImportDrawer
        open={paloaltoOpen}
        subnets={subnets}
        onClose={() => {
          setPaloaltoOpen(false);
          void fetchSubnets();
        }}
      />
      <ZabbixImportDrawer
        open={zabbixOpen}
        subnets={subnets}
        onClose={() => {
          setZabbixOpen(false);
          void fetchSubnets();
        }}
      />
    </div>
  );
};

export default IntegrationsPage;

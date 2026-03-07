import React, { useState } from 'react';
import {
  Drawer,
  Typography,
  Tag,
  Collapse,
  Input,
  Space,
  Badge,
  Alert,
} from 'antd';
import {
  GlobalOutlined,
  ApartmentOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  NodeIndexOutlined,
  EnvironmentOutlined,
  TeamOutlined,
  DashboardOutlined,
  ScanOutlined,
  HistoryOutlined,
  CheckSquareOutlined,
  WarningOutlined,
  SearchOutlined,
  LockOutlined,
  UnlockOutlined,
  EditOutlined,
  EyeOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface Section {
  key: string;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  content: React.ReactNode;
}

const RoleBadge = ({ role }: { role: 'Viewer' | 'Operator' | 'Administrator' }) => {
  const color = role === 'Administrator' ? 'red' : role === 'Operator' ? 'blue' : 'default';
  return <Tag color={color} style={{ fontSize: 11 }}>{role}+</Tag>;
};

const ALL_SECTIONS: Section[] = [
  {
    key: 'dashboard',
    icon: <DashboardOutlined />,
    title: 'Dashboard',
    content: (
      <>
        <Paragraph>
          The <Text strong>Dashboard</Text> gives a real-time overview of your entire IP address space in one view.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li><Text strong>Stat cards</Text> — total IPs, free/reserved/in-use counts, subnet and VRF totals</li>
          <li><Text strong>IP Status pie chart</Text> — donut showing the split between Free, Reserved, and In Use addresses</li>
          <li><Text strong>IPs by Environment bar chart</Text> — how many IPs exist per environment (Production, Staging, etc.)</li>
          <li><Text strong>IPs by OS Type bar chart</Text> — breakdown by operating system</li>
          <li><Text strong>Top Subnets table</Text> — the most-utilised subnets; subnets with an alert threshold configured are highlighted when exceeded</li>
          <li><Text strong>Recent Activity timeline</Text> — the last 5 changes made by any user</li>
        </ul>
        <Alert
          type="info"
          showIcon
          style={{ fontSize: 12 }}
          message="If any subnet exceeds its alert threshold, a red banner appears at the top of the Dashboard."
        />
      </>
    ),
  },
  {
    key: 'ip-records',
    icon: <GlobalOutlined />,
    title: 'IP Records',
    content: (
      <>
        <Paragraph>
          An <Text strong>IP Record</Text> represents a single IPv4 address tracked in your network.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>IP address + optional hostname</li>
          <li>Parent subnet and optional VRF</li>
          <li>Operating system: <Tag>Linux</Tag><Tag>Windows</Tag><Tag>AIX</Tag><Tag>macOS</Tag><Tag>OpenShift</Tag><Tag>Unknown</Tag></li>
          <li>Status: <Tag color="green">Free</Tag> <Tag color="orange">Reserved</Tag> <Tag color="blue">In Use</Tag></li>
          <li>Environment, owner, description</li>
        </ul>
        <Paragraph style={{ marginBottom: 4 }}><Text strong>Actions per row:</Text></Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
          <li><LockOutlined /> <Text strong>Reserve</Text> — marks a Free IP as Reserved <RoleBadge role="Operator" /></li>
          <li><UnlockOutlined /> <Text strong>Release</Text> — sets a Reserved IP back to Free <RoleBadge role="Operator" /></li>
          <li><EditOutlined /> <Text strong>Edit</Text> — update hostname, OS, environment, owner <RoleBadge role="Operator" /></li>
          <li><HistoryOutlined /> <Text strong>History</Text> — view the full change log for this IP <RoleBadge role="Viewer" /></li>
        </ul>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Use the search bar to find IPs by address, hostname, owner, or description. Filters for Status, OS, Environment, and Subnet are also available.
        </Paragraph>
      </>
    ),
  },
  {
    key: 'bulk',
    icon: <CheckSquareOutlined />,
    title: 'Bulk Operations',
    badge: 'New',
    content: (
      <>
        <Paragraph>
          Select multiple IP records using the <Text strong>checkboxes</Text> in the IP Records table to act on them all at once.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li><Text strong>Reserve</Text> — sets all selected IPs to Reserved status</li>
          <li><Text strong>Release</Text> — sets all selected IPs back to Free</li>
          <li><Text strong>Update Fields</Text> — change Environment, OS Type, or Owner for all selected records at once (only filled-in fields are changed)</li>
          <li><Text strong>Clear</Text> — deselects all rows</li>
        </ul>
        <Alert
          type="warning"
          showIcon
          style={{ fontSize: 12 }}
          message="Bulk operations write one audit log entry per modified record so changes remain fully traceable."
        />
      </>
    ),
  },
  {
    key: 'history',
    icon: <HistoryOutlined />,
    title: 'Change History',
    badge: 'New',
    content: (
      <>
        <Paragraph>
          Every IP record and subnet keeps a full audit trail. Click the <HistoryOutlined /> <Text strong>History</Text> button on any row to open the change timeline.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
          <li>Shows the last 50 changes sorted newest-first</li>
          <li>Each entry shows: action tag, username, relative timestamp (hover for exact time)</li>
          <li>For <Tag color="blue">UPDATE</Tag> events, a diff is shown — which fields changed and their old → new values</li>
          <li>Action types: <Tag color="green">CREATE</Tag> <Tag color="blue">UPDATE</Tag> <Tag color="red">DELETE</Tag> <Tag color="orange">RESERVE</Tag> <Tag color="cyan">RELEASE</Tag></li>
        </ul>
      </>
    ),
  },
  {
    key: 'subnets',
    icon: <ApartmentOutlined />,
    title: 'Subnets (Prefix Hierarchy)',
    content: (
      <>
        <Paragraph>
          A <Text strong>Subnet</Text> is a block of IP addresses in CIDR notation (e.g. <Text code>192.168.1.0/24</Text>).
          Subnets are automatically nested — a smaller subnet is placed as a child of the largest subnet that contains it.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li><Text strong>Container subnets</Text> — have child prefixes; utilization = delegated address space</li>
          <li><Text strong>Leaf subnets</Text> — hold IP records directly; utilization = IP count</li>
        </ul>
        <Paragraph style={{ marginBottom: 4 }}><Text strong>Alert Threshold</Text> <Tag color="orange">New</Tag></Paragraph>
        <Paragraph>
          Set an optional utilization alert (1–100%) on any subnet. When the subnet's utilization reaches or exceeds the threshold, a <WarningOutlined style={{ color: '#ff4d4f' }} /> warning icon appears on the subnet row and a red banner is shown on the Dashboard.
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Example hierarchy: <Text code>10.0.0.0/8</Text> → <Text code>10.10.0.0/16</Text> → <Text code>10.10.1.0/24</Text>
        </Paragraph>
      </>
    ),
  },
  {
    key: 'scanner',
    icon: <ScanOutlined />,
    title: 'Network Scanner',
    content: (
      <>
        <Paragraph>
          The <Text strong>Network Scanner</Text> actively probes a subnet to discover live hosts and auto-populate IP records.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>Enter a CIDR range (e.g. <Text code>192.168.1.0/24</Text>) to scan</li>
          <li>Detected hosts are shown with their reverse DNS hostname and detected OS</li>
          <li>Select discovered hosts and click <Text strong>Create IP Records</Text> to import them into IPAM</li>
          <li>OS detection identifies Linux, Windows, macOS, AIX, and OpenShift nodes</li>
        </ul>
        <Alert
          type="warning"
          showIcon
          style={{ fontSize: 12 }}
          message="Only scan networks you are authorised to probe. Network scanning generates traffic that may be detected by security monitoring."
        />
      </>
    ),
  },
  {
    key: 'vrfs',
    icon: <ClusterOutlined />,
    title: 'VRFs',
    content: (
      <>
        <Paragraph>
          A <Text strong>VRF (Virtual Routing and Forwarding)</Text> is an isolated routing domain — a virtual network inside the same physical infrastructure. VRFs allow the same IP ranges to be reused without conflict.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>Multi-tenant environments where customers share hardware</li>
          <li>Separating management, production, and out-of-band networks</li>
          <li>Overlapping IP ranges across different sites or business units</li>
        </ul>
        <Paragraph>
          The <Text strong>Route Distinguisher (RD)</Text> (e.g. <Text code>65000:100</Text>) is an optional MPLS/BGP identifier that uniquely labels the VRF across the wider network.
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          If VRFs are not relevant to your setup, leave everything in the <Text strong>Global</Text> space (no VRF selected).
        </Paragraph>
      </>
    ),
  },
  {
    key: 'aggregates',
    icon: <DatabaseOutlined />,
    title: 'Aggregates & RIRs',
    content: (
      <>
        <Paragraph>
          <Text strong>Aggregates</Text> are the top-level address blocks assigned to your organisation by a <Text strong>Regional Internet Registry (RIR)</Text>. They give a high-level view of all address space you own or manage.
        </Paragraph>
        <Paragraph><Text strong>RIRs by region:</Text></Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
          <li><Text strong>ARIN</Text> — North America</li>
          <li><Text strong>RIPE NCC</Text> — Europe, Middle East, Central Asia</li>
          <li><Text strong>APNIC</Text> — Asia-Pacific</li>
          <li><Text strong>LACNIC</Text> — Latin America &amp; Caribbean</li>
          <li><Text strong>AFRINIC</Text> — Africa</li>
          <li><Text strong>RFC1918</Text> — Private ranges (<Text code>10.x</Text>, <Text code>172.16.x</Text>, <Text code>192.168.x</Text>)</li>
        </ul>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Aggregates are informational — they are not linked to subnets by a database key.
        </Paragraph>
      </>
    ),
  },
  {
    key: 'ip-ranges',
    icon: <NodeIndexOutlined />,
    title: 'IP Ranges',
    content: (
      <>
        <Paragraph>
          An <Text strong>IP Range</Text> is a named span of consecutive addresses within a subnet — useful for DHCP pools, reserved server blocks, or any contiguous group that doesn't need per-address tracking.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
          <li>Ranges cannot overlap each other within the same subnet</li>
          <li>Start and end addresses must fall within the parent subnet's CIDR</li>
          <li>Status: <Tag color="green">Active</Tag> <Tag color="orange">Reserved</Tag> <Tag>Deprecated</Tag></li>
        </ul>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Manage ranges from the subnet detail panel — click any CIDR in the Subnets table to open it.
        </Paragraph>
      </>
    ),
  },
  {
    key: 'environments',
    icon: <EnvironmentOutlined />,
    title: 'Environments',
    content: (
      <>
        <Paragraph>
          Every subnet and IP record is tagged with an <Text strong>Environment</Text> indicating its role in the delivery lifecycle:
        </Paragraph>
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag color="red">Production</Tag>
          <Tag color="gold">Staging</Tag>
          <Tag color="purple">UAT</Tag>
          <Tag color="volcano">QA</Tag>
          <Tag color="orange">Test</Tag>
          <Tag color="cyan">Development</Tag>
          <Tag color="magenta">DR</Tag>
          <Tag color="geekblue">Lab</Tag>
        </Space>
        <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
          <li><Tag color="red">Production</Tag> live customer-facing infrastructure</li>
          <li><Tag color="gold">Staging</Tag> final validation before production release</li>
          <li><Tag color="purple">UAT</Tag> user acceptance testing by business stakeholders</li>
          <li><Tag color="volcano">QA</Tag> quality assurance / automated test runs</li>
          <li><Tag color="orange">Test</Tag> general-purpose testing</li>
          <li><Tag color="cyan">Development</Tag> developer workstations and internal services</li>
          <li><Tag color="magenta">DR</Tag> disaster recovery standby environment</li>
          <li><Tag color="geekblue">Lab</Tag> experimental or proof-of-concept work</li>
        </ul>
      </>
    ),
  },
  {
    key: 'roles',
    icon: <TeamOutlined />,
    title: 'User Roles & Permissions',
    content: (
      <>
        <Paragraph>Access is controlled by three hierarchical roles:</Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            <Space size={4}>
              <EyeOutlined style={{ color: '#8c8c8c' }} />
              <Text strong>Viewer</Text>
            </Space>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Read-only access — browse subnets, IP records, VRFs, aggregates, and view history.
            </Text>
          </li>
          <li style={{ marginTop: 8 }}>
            <Space size={4}>
              <EditOutlined style={{ color: '#1677ff' }} />
              <Text strong>Operator</Text>
            </Space>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              All Viewer permissions plus: create/edit subnets, IP records, VRFs, aggregates, IP ranges; reserve/release IPs; bulk operations; run network scans.
            </Text>
          </li>
          <li style={{ marginTop: 8 }}>
            <Space size={4}>
              <LockOutlined style={{ color: '#ff4d4f' }} />
              <Text strong>Administrator</Text>
            </Space>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              All Operator permissions plus: delete records, manage users, view all audit log events.
            </Text>
          </li>
        </ul>
        <Alert
          type="info"
          showIcon
          style={{ fontSize: 12 }}
          message="Roles are hierarchical — Administrator includes Operator, Operator includes Viewer."
        />
      </>
    ),
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

const HelpDrawer: React.FC<Props> = ({ open, onClose }) => {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? ALL_SECTIONS.filter(
        (s) =>
          s.title.toLowerCase().includes(search.toLowerCase()) ||
          s.key.toLowerCase().includes(search.toLowerCase())
      )
    : ALL_SECTIONS;

  return (
    <Drawer
      title="IPAM Concepts & Help"
      open={open}
      onClose={() => {
        setSearch('');
        onClose();
      }}
      width={540}
      styles={{ body: { paddingTop: 12 } }}
    >
      <Input
        prefix={<SearchOutlined style={{ color: '#8c8c8c' }} />}
        placeholder="Search topics…"
        allowClear
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16 }}
      />

      {filtered.length === 0 ? (
        <Typography.Text type="secondary">No topics match "{search}"</Typography.Text>
      ) : (
        <Collapse
          accordion={false}
          defaultActiveKey={['dashboard']}
          expandIconPosition="end"
          items={filtered.map((section) => ({
            key: section.key,
            label: (
              <Space size={8}>
                <span style={{ color: '#1677ff', fontSize: 15 }}>{section.icon}</span>
                <Text strong style={{ fontSize: 14 }}>{section.title}</Text>
                {section.badge && (
                  <Badge
                    count={section.badge}
                    style={{ backgroundColor: '#52c41a', fontSize: 10, height: 16, lineHeight: '16px', padding: '0 5px' }}
                  />
                )}
              </Space>
            ),
            children: <Typography>{section.content}</Typography>,
          }))}
        />
      )}
    </Drawer>
  );
};

export default HelpDrawer;

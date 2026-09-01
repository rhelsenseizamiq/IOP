import React, { useState } from "react";
import {
  Drawer,
  Typography,
  Tag,
  Collapse,
  Input,
  Space,
  Badge,
  Alert,
} from "antd";
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
  CloudServerOutlined,
  BugOutlined,
  ApiOutlined,
  SafetyCertificateOutlined,
  WifiOutlined,
  ThunderboltOutlined,
  AimOutlined,
  PlusCircleOutlined,
  DesktopOutlined,
  AuditOutlined,
  LoadingOutlined,
  LinkOutlined,
  UnorderedListOutlined,
  InboxOutlined,
} from "@ant-design/icons";

const { Text, Paragraph } = Typography;

interface Section {
  key: string;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  content: React.ReactNode;
}

const RoleBadge = ({
  role,
}: {
  role: "Viewer" | "Operator" | "Administrator";
}) => {
  const color =
    role === "Administrator" ? "red" : role === "Operator" ? "blue" : "default";
  return (
    <Tag color={color} style={{ fontSize: 11 }}>
      {role}+
    </Tag>
  );
};

const ALL_SECTIONS: Section[] = [
  // ─── Dashboard ────────────────────────────────────────────────────────────
  {
    key: "dashboard",
    icon: <DashboardOutlined />,
    title: "Dashboard",
    content: (
      <>
        <Paragraph>
          The <Text strong>Dashboard</Text> gives a real-time overview of your
          entire IP address space in one view.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            <Text strong>Stat cards</Text> — total IPs, free/reserved/in-use
            counts, subnet and VRF totals
          </li>
          <li>
            <Text strong>IP Status pie chart</Text> — donut showing the split
            between Free, Reserved, and In Use addresses
          </li>
          <li>
            <Text strong>IPs by Environment bar chart</Text> — how many IPs
            exist per environment (Production, Staging, etc.)
          </li>
          <li>
            <Text strong>IPs by OS Type bar chart</Text> — breakdown by
            operating system
          </li>
          <li>
            <Text strong>Top Subnets table</Text> — the most-utilised subnets;
            subnets with an alert threshold are highlighted when exceeded
          </li>
          <li>
            <Text strong>Recent Activity timeline</Text> — the last 5 changes
            made by any user
          </li>
          <li>
            <Text strong>Data Sync Health</Text> — freshness of the nightly
            Device42, Zabbix, and PaloAlto full-inventory syncs (last run time,
            duration, counters); flags a source as "Overdue" past 27 hours since
            its last run
          </li>
          <li>
            <SafetyCertificateOutlined /> <Text strong>PaloAlto Activity</Text>{" "}
            <Badge
              count="New"
              style={{
                backgroundColor: "#52c41a",
                fontSize: 10,
                height: 16,
                lineHeight: "16px",
                padding: "0 5px",
              }}
            />{" "}
            — real-time Check Availability usage, distinct from the nightly sync
            above: checks in the last 24h/7d, % found in-use over 7 days, and
            the 5 most recent lookups (IP, hostname, who, when)
          </li>
          <li>
            <WarningOutlined style={{ color: "#e8a85f" }} />{" "}
            <Text strong>Stale "In Use" Records</Text>{" "}
            <Badge
              count="New"
              style={{
                backgroundColor: "#52c41a",
                fontSize: 10,
                height: 16,
                lineHeight: "16px",
                padding: "0 5px",
              }}
            />{" "}
            — records marked <Tag color="blue">In Use</Tag> that no source
            (Device42, Zabbix, PaloAlto, or a manual check) has re-confirmed in
            over 90 days. Purely informational — nothing is auto-changed. Click{" "}
            <Text strong>View all</Text> for the full list, or{" "}
            <Text strong>Bulk Scan All</Text> to re-check every one of them
            through Device42 + Zabbix + PaloAlto in one go{" "}
            <RoleBadge role="Administrator" />
          </li>
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

  // ─── IP Records ───────────────────────────────────────────────────────────
  {
    key: "ip-records",
    icon: <GlobalOutlined />,
    title: "IP Records",
    content: (
      <>
        <Paragraph>
          An <Text strong>IP Record</Text> represents a single IPv4 or IPv6
          address tracked in your network.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>IP address (IPv4 or IPv6) + optional hostname</li>
          <li>Parent subnet and optional VRF</li>
          <li>
            Operating system: <Tag>Linux</Tag>
            <Tag>Windows</Tag>
            <Tag>AIX</Tag>
            <Tag>macOS</Tag>
            <Tag>OpenShift</Tag>
            <Tag>Unknown</Tag>
          </li>
          <li>
            Status: <Tag color="green">Free</Tag>{" "}
            <Tag color="orange">Reserved</Tag> <Tag color="blue">In Use</Tag>
          </li>
          <li>Environment, owner, description</li>
        </ul>

        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>Actions per row:</Text>
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            <LockOutlined /> <Text strong>Reserve</Text> — marks a Free IP as
            Reserved <RoleBadge role="Operator" />
          </li>
          <li>
            <UnlockOutlined /> <Text strong>Release</Text> — sets a Reserved IP
            back to Free <RoleBadge role="Operator" />
          </li>
          <li>
            <EditOutlined /> <Text strong>Edit</Text> — update hostname, OS,
            environment, owner <RoleBadge role="Operator" />
          </li>
          <li>
            <HistoryOutlined /> <Text strong>History</Text> — view the full
            change log for this IP <RoleBadge role="Viewer" />
          </li>
        </ul>

        <Paragraph style={{ marginBottom: 4 }}>
          <WifiOutlined style={{ color: "#1677ff" }} />{" "}
          <Text strong>Check Availability</Text> (right-click any IP address){" "}
          <Badge
            count="Updated"
            style={{
              backgroundColor: "#1677ff",
              fontSize: 10,
              height: 16,
              lineHeight: "16px",
              padding: "0 5px",
            }}
          />{" "}
          <RoleBadge role="Administrator" />
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          One click now scans <Text strong>all three sources in sequence</Text>{" "}
          — Device42, then Zabbix, then PaloAlto — instead of picking one at a
          time. A live progress modal shows each source as it's checked
          ("checking… → found / not found") and applies the combined result
          immediately:
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            <Text strong>Device42</Text> — real-time inventory lookup, not a
            network probe; shows the assigned device, or that Device42 has no
            record for it
          </li>
          <li>
            <Text strong>Zabbix</Text> — real-time live monitoring lookup;
            Zabbix actively polls its hosts, so this reflects genuinely current
            up/down status
          </li>
          <li>
            <Text strong>PaloAlto</Text> — checks every configured firewall for
            a named address object, live ARP entry, NAT rule, or security policy
            referencing the address
          </li>
        </ul>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          Any single source finding a positive match can upgrade the record to{" "}
          <Tag color="blue">In Use</Tag> — this is{" "}
          <Text strong>asymmetric on purpose</Text>: no source is guaranteed
          complete, so a miss from all three never auto-downgrades a record to
          Free, and a <Tag color="orange">Reserved</Tag> record is never
          auto-released. When PaloAlto finds it, hostname is enriched from the
          match; when Device42 or Zabbix return an OS name,{" "}
          <Text strong>OS Type</Text> is filled in too (Zabbix only if that host
          has inventory data populated) — same upgrade-only rule applies to
          both.
        </Paragraph>

        <Paragraph style={{ marginBottom: 4 }}>
          <SearchOutlined /> <Text strong>Show Duplicates</Text>{" "}
          <Badge
            count="New"
            style={{
              backgroundColor: "#52c41a",
              fontSize: 10,
              height: 16,
              lineHeight: "16px",
              padding: "0 5px",
            }}
          />{" "}
          <RoleBadge role="Operator" />
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          Toolbar button next to Export/Import. Finds records sharing the exact
          same <Text strong>hostname</Text> or <Text strong>IP address</Text> —
          hostname duplicates are common (e.g. a decommissioned host's name left
          on a stale record after its address was reassigned); IP duplicates
          should never exist (there's a database uniqueness constraint) but are
          checked anyway as a safety net. Each tab has its own{" "}
          <Text strong>Bulk Scan All</Text> button{" "}
          <RoleBadge role="Administrator" /> to re-check every affected record
          through Device42 + Zabbix + PaloAlto in one pass.
        </Paragraph>

        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          <LinkOutlined /> Navigating here from a subnet's{" "}
          <Text strong>"View all IP records"</Text> button automatically
          pre-selects that subnet in the filter bar. Use Search, Status, OS,
          Environment, and Subnet filters to narrow the list.
        </Paragraph>
      </>
    ),
  },

  // ─── Unused IP Addresses ──────────────────────────────────────────────────
  {
    key: "unused-ips",
    icon: <UnorderedListOutlined />,
    title: "Unused IP Addresses",
    badge: "New",
    content: (
      <>
        <Paragraph>
          Shows every address in a subnet's CIDR that has{" "}
          <Text strong>no IP record at all</Text> — distinct from{" "}
          <Tag color="green">Free</Tag> status, which only covers addresses
          already recorded as available. No network scanning is involved; it's
          calculated purely from the subnet's CIDR minus what's already
          recorded, so it covers every subnet the same way whether its data came
          from Device42, Zabbix, a scan, or manual entry.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            <InboxOutlined /> <Text strong>Stat cards</Text> — total addresses
            available across all subnets, how many subnets have room, and the
            single subnet with the most room to grow
          </li>
          <li>Search box to filter the subnet cards by name or CIDR</li>
          <li>
            Each card shows a friendly "N free" count and a utilization bar —
            click to drill into the actual address list for that subnet
          </li>
          <li>
            Inside a subnet: filter by IP, run{" "}
            <Text strong>Check Availability</Text> directly on any unused
            address, or click <Text strong>Create</Text> to turn it into a real
            IP record on the spot
          </li>
        </ul>
        <Alert
          type="info"
          showIcon
          style={{ fontSize: 12 }}
          message="Very large subnets (e.g. a /13 or bigger) are capped at the first 65,536 addresses scanned per request — the count shown may be a lower bound for those."
        />
      </>
    ),
  },

  // ─── Bulk Operations ──────────────────────────────────────────────────────
  {
    key: "bulk",
    icon: <CheckSquareOutlined />,
    title: "Bulk Operations",
    content: (
      <>
        <Paragraph>
          Select multiple IP records using the <Text strong>checkboxes</Text> in
          the IP Records table to act on them all at once.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            <Text strong>Reserve</Text> — sets all selected IPs to Reserved
            status
          </li>
          <li>
            <Text strong>Release</Text> — sets all selected IPs back to Free
          </li>
          <li>
            <Text strong>Update Fields</Text> — change Environment, OS Type, or
            Owner for all selected records at once (only filled-in fields are
            changed)
          </li>
          <li>
            <Text strong>Clear</Text> — deselects all rows
          </li>
        </ul>
        <Alert
          type="warning"
          showIcon
          style={{ fontSize: 12, marginBottom: 12 }}
          message="Bulk operations write one audit log entry per modified record so changes remain fully traceable."
        />
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Not to be confused with <Text strong>Bulk Scan</Text> — a different
          feature, triggered from the Dashboard's Stale In-Use panel or the Show
          Duplicates modal, that re-checks a set of records against
          Device42/Zabbix/PaloAlto rather than editing fields directly.
        </Paragraph>
      </>
    ),
  },

  // ─── Change History ───────────────────────────────────────────────────────
  {
    key: "history",
    icon: <HistoryOutlined />,
    title: "Change History",
    content: (
      <>
        <Paragraph>
          Every IP record and subnet keeps a full audit trail. Click the{" "}
          <HistoryOutlined /> <Text strong>History</Text> button on any row to
          open the change timeline.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
          <li>Shows the last 50 changes sorted newest-first</li>
          <li>
            Each entry shows: action tag, username, relative timestamp (hover
            for exact time)
          </li>
          <li>
            For <Tag color="blue">UPDATE</Tag> events, a diff is shown — which
            fields changed and their old → new values
          </li>
          <li>
            Action types: <Tag color="green">CREATE</Tag>{" "}
            <Tag color="blue">UPDATE</Tag> <Tag color="red">DELETE</Tag>{" "}
            <Tag color="orange">RESERVE</Tag> <Tag color="cyan">RELEASE</Tag>
          </li>
        </ul>
      </>
    ),
  },

  // ─── Subnets ──────────────────────────────────────────────────────────────
  {
    key: "subnets",
    icon: <ApartmentOutlined />,
    title: "Subnets (Prefix Hierarchy)",
    content: (
      <>
        <Paragraph>
          A <Text strong>Subnet</Text> is a block of IP addresses in CIDR
          notation (e.g. <Text code>192.168.1.0/24</Text> or{" "}
          <Text code>2001:db8::/48</Text>). Subnets are automatically nested — a
          smaller subnet is placed as a child of the largest subnet that
          contains it.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            <Text strong>Container subnets</Text> — have child prefixes;
            utilization = delegated address space
          </li>
          <li>
            <Text strong>Leaf subnets</Text> — hold IP records directly;
            utilization = IP count
          </li>
          <li>
            <Tag color="blue">IPv4</Tag> <Tag color="purple">IPv6</Tag> — choose
            the IP version when creating a subnet
          </li>
        </ul>

        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>Subnet Detail Panel</Text>
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          Click any CIDR in the Subnets table to open the detail panel. From
          there you can:
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>View IP utilization bar (used / reserved / free counts)</li>
          <li>
            Manage <Text strong>IP Ranges</Text> (DHCP pools, server blocks,
            etc.)
          </li>
          <li>
            Run a <BugOutlined /> <Text strong>Conflict Scan</Text> to detect
            DNS inconsistencies
          </li>
          <li>
            Click <Text strong>"View all IP records in this subnet →"</Text> to
            jump directly to IP Records with that subnet pre-filtered
          </li>
        </ul>

        <Paragraph style={{ marginBottom: 4 }}>
          <SafetyCertificateOutlined /> <Text strong>Scan in PaloAlto</Text>{" "}
          (right-click any subnet){" "}
          <Badge
            count="New"
            style={{
              backgroundColor: "#52c41a",
              fontSize: 10,
              height: 16,
              lineHeight: "16px",
              padding: "0 5px",
            }}
          />{" "}
          <RoleBadge role="Operator" />
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          Bulk-checks every host address in the subnet against every configured
          PaloAlto firewall, with a live progress bar and trace log, then
          auto-saves found addresses into IP Records and refreshes the subnet's
          utilization stats. The summary also lists the{" "}
          <Text strong>top security/NAT rules</Text> that actually reference
          addresses in that subnet, with hit counts — useful before resizing or
          decommissioning a subnet to see what still points at it.
        </Paragraph>

        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>Alert Threshold</Text>
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Set an optional utilization alert (1–100%) on any subnet. When
          utilization reaches the threshold, a{" "}
          <WarningOutlined style={{ color: "#ff4d4f" }} /> warning icon appears
          on the subnet row and a red banner is shown on the Dashboard.
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Example hierarchy: <Text code>10.0.0.0/8</Text> →{" "}
          <Text code>10.10.0.0/16</Text> → <Text code>10.10.1.0/24</Text>
        </Paragraph>
      </>
    ),
  },

  // ─── Network Scanner ──────────────────────────────────────────────────────
  {
    key: "scanner",
    icon: <ScanOutlined />,
    title: "Network Scanner",
    badge: "Updated",
    content: (
      <>
        <Paragraph>
          The <Text strong>Network Scanner</Text> actively probes IP ranges to
          discover live hosts. It has two independent tabs:
        </Paragraph>

        {/* Scan modes */}
        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>Scan Modes</Text>
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            <ThunderboltOutlined style={{ color: "#52c41a" }} />{" "}
            <Tag color="green">Quick</Tag>— 4 ports · no OS detection · no
            hostname lookup · up to <Text code>/20</Text> (4 094 hosts)
          </li>
          <li>
            <AimOutlined style={{ color: "#1677ff" }} />{" "}
            <Tag color="blue">Standard</Tag>— 14 ports · OS detection · hostname
            lookup · up to <Text code>/22</Text> (1 022 hosts)
          </li>
          <li>
            <BugOutlined style={{ color: "#722ed1" }} />{" "}
            <Tag color="purple">Deep</Tag>— 35 ports · full OS detection ·
            hostname lookup · up to <Text code>/24</Text> (254 hosts)
          </li>
        </ul>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          A <LoadingOutlined /> animated <Text strong>progress indicator</Text>{" "}
          shows completion percentage while scanning. For Host Discovery it is a
          circular gauge; for Infrastructure Scan it is a line bar with the
          current % shown.
        </Paragraph>

        {/* Host Discovery tab */}
        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>Host Discovery tab</Text>
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            Enter a single CIDR and click <Text strong>Scan</Text>
          </li>
          <li>
            Discovered hosts are grouped by subnet and shown in a table (IP,
            Hostname, OS Type, Open Ports for Deep mode)
          </li>
          <li>Edit hostname or OS type inline before importing</li>
          <li>
            Select rows and click <Text strong>Import Selected</Text> to create
            IP Records; choose the Environment first
          </li>
          <li>
            Hosts with no matching subnet can be assigned to an existing subnet
            or create a new one on the spot
          </li>
        </ul>

        {/* Infrastructure Scan tab */}
        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>Infrastructure Scan tab</Text>
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            Enter one or more CIDRs (one per line or comma-separated) to scan
            all at once
          </li>
          <li>
            Active hosts are stored as <Tag color="blue">In Use</Tag> in the
            database automatically
          </li>
          <li>
            Toggle <Text strong>"Store non-responding IPs as Free"</Text> to
            also record inactive addresses
          </li>
          <li>
            Toggle <Text strong>"Overwrite existing record status"</Text> to
            update existing IP records based on the current scan result
          </li>
          <li>
            <PlusCircleOutlined style={{ color: "#52c41a" }} />{" "}
            <Text strong>Auto-subnet creation</Text> — if a discovered IP has no
            matching subnet, the scanner automatically creates a{" "}
            <Text code>/24</Text> subnet named "Auto-created (scan)" in the
            Production environment and stores the IP under it. No manual subnet
            setup needed.
          </li>
        </ul>

        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>After an Infrastructure Scan:</Text>
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            <Tag color="blue">Scanned</Tag> total hosts probed
          </li>
          <li>
            <Tag color="green">Active</Tag> hosts that responded
          </li>
          <li>
            <Tag color="cyan">Created</Tag> new IP records added — with a full
            list of every created IP address (sortable, copyable)
          </li>
          <li>
            <Tag color="purple">Updated</Tag> existing records whose status
            changed (when overwrite is on) — with list
          </li>
          <li>
            <Tag color="orange">Auto-subnets</Tag> new /24 subnets created
            automatically — with list of CIDRs
          </li>
          <li>
            <Tag color="default">Skipped</Tag> IPs that could not be processed
          </li>
        </ul>

        <Alert
          type="warning"
          showIcon
          style={{ fontSize: 12 }}
          message="Only scan networks you are authorised to probe. Scanning generates traffic that may be detected by security monitoring."
        />
      </>
    ),
  },

  // ─── Asset Inventory (CMDB) ───────────────────────────────────────────────
  {
    key: "assets",
    icon: <DesktopOutlined />,
    title: "Asset Inventory (CMDB)",
    badge: "New",
    content: (
      <>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
          message="This module is currently disabled in the sidebar (unused) but the data and API remain intact."
        />
        <Paragraph>
          The <Text strong>Asset Inventory</Text> (sidebar → Assets) is a
          lightweight CMDB — a register of physical and virtual infrastructure
          assets across your organisation.
        </Paragraph>
        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>Asset Types:</Text>
        </Paragraph>
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag color="blue">Server</Tag>
          <Tag color="cyan">Switch</Tag>
          <Tag color="geekblue">Router</Tag>
          <Tag color="red">Firewall</Tag>
          <Tag color="purple">Load Balancer</Tag>
          <Tag color="gold">Storage</Tag>
          <Tag color="lime">Virtual Machine</Tag>
          <Tag>Other</Tag>
        </Space>
        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>Fields per asset:</Text>
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            <Text strong>Name</Text> — hostname or asset label
          </li>
          <li>
            <Text strong>Type</Text> — from the list above
          </li>
          <li>
            <Text strong>Status</Text>: <Tag color="success">Active</Tag>{" "}
            <Tag color="warning">Maintenance</Tag> <Tag>Inactive</Tag>{" "}
            <Tag color="error">Decommissioned</Tag>
          </li>
          <li>
            <Text strong>IP Address</Text> — optional; free-text (not linked to
            an IP Record)
          </li>
          <li>
            <Text strong>Vendor / Model / Serial Number</Text>
          </li>
          <li>
            <Text strong>Data Centre / Rack Location</Text>
          </li>
          <li>
            <Text strong>Warranty Expiry</Text> — a{" "}
            <WarningOutlined style={{ color: "#faad14" }} /> warning icon
            appears when expiry is within 30 days
          </li>
          <li>
            <Text strong>Description</Text>
          </li>
        </ul>
        <Alert
          type="info"
          showIcon
          style={{ fontSize: 12 }}
          message="Assets can be searched by name, vendor, model, serial number, or IP address. Filter by Type, Status, or Data Centre."
        />
      </>
    ),
  },

  // ─── VRFs ─────────────────────────────────────────────────────────────────
  {
    key: "vrfs",
    icon: <ClusterOutlined />,
    title: "VRFs",
    content: (
      <>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
          message="This module is currently disabled in the sidebar (unused) but the data and API remain intact."
        />
        <Paragraph>
          A <Text strong>VRF (Virtual Routing and Forwarding)</Text> is an
          isolated routing domain — a virtual network inside the same physical
          infrastructure. VRFs allow the same IP ranges to be reused without
          conflict.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>Multi-tenant environments where customers share hardware</li>
          <li>Separating management, production, and out-of-band networks</li>
          <li>
            Overlapping IP ranges across different sites or business units
          </li>
        </ul>
        <Paragraph>
          The <Text strong>Route Distinguisher (RD)</Text> (e.g.{" "}
          <Text code>65000:100</Text>) is an optional MPLS/BGP identifier that
          uniquely labels the VRF across the wider network.
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          If VRFs are not relevant to your setup, leave everything in the{" "}
          <Text strong>Global</Text> space (no VRF selected).
        </Paragraph>
      </>
    ),
  },

  // ─── Aggregates & RIRs ────────────────────────────────────────────────────
  {
    key: "aggregates",
    icon: <DatabaseOutlined />,
    title: "Aggregates & RIRs",
    content: (
      <>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
          message="This module is currently disabled in the sidebar (unused) but the data and API remain intact."
        />
        <Paragraph>
          <Text strong>Aggregates</Text> are the top-level address blocks
          assigned to your organisation by a{" "}
          <Text strong>Regional Internet Registry (RIR)</Text>. They give a
          high-level view of all address space you own or manage.
        </Paragraph>
        <Paragraph>
          <Text strong>RIRs by region:</Text>
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
          <li>
            <Text strong>ARIN</Text> — North America
          </li>
          <li>
            <Text strong>RIPE NCC</Text> — Europe, Middle East, Central Asia
          </li>
          <li>
            <Text strong>APNIC</Text> — Asia-Pacific
          </li>
          <li>
            <Text strong>LACNIC</Text> — Latin America &amp; Caribbean
          </li>
          <li>
            <Text strong>AFRINIC</Text> — Africa
          </li>
          <li>
            <Text strong>RFC1918</Text> — Private ranges (<Text code>10.x</Text>
            , <Text code>172.16.x</Text>, <Text code>192.168.x</Text>)
          </li>
        </ul>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Aggregates are informational — they are not linked to subnets by a
          database key.
        </Paragraph>
      </>
    ),
  },

  // ─── IP Ranges ────────────────────────────────────────────────────────────
  {
    key: "ip-ranges",
    icon: <NodeIndexOutlined />,
    title: "IP Ranges",
    content: (
      <>
        <Paragraph>
          An <Text strong>IP Range</Text> is a named span of consecutive
          addresses within a subnet — useful for DHCP pools, reserved server
          blocks, or any contiguous group that doesn't need per-address
          tracking.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
          <li>Ranges cannot overlap each other within the same subnet</li>
          <li>
            Start and end addresses must fall within the parent subnet's CIDR
          </li>
          <li>
            Status: <Tag color="green">Active</Tag>{" "}
            <Tag color="orange">Reserved</Tag> <Tag>Deprecated</Tag>
          </li>
        </ul>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Manage ranges from the subnet detail panel — click any CIDR in the
          Subnets table to open it.
        </Paragraph>
      </>
    ),
  },

  // ─── Environments ─────────────────────────────────────────────────────────
  {
    key: "environments",
    icon: <EnvironmentOutlined />,
    title: "Environments",
    content: (
      <>
        <Paragraph>
          Every subnet and IP record is tagged with an{" "}
          <Text strong>Environment</Text> indicating its role in the delivery
          lifecycle:
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
          <li>
            <Tag color="red">Production</Tag> live customer-facing
            infrastructure
          </li>
          <li>
            <Tag color="gold">Staging</Tag> final validation before production
            release
          </li>
          <li>
            <Tag color="purple">UAT</Tag> user acceptance testing by business
            stakeholders
          </li>
          <li>
            <Tag color="volcano">QA</Tag> quality assurance / automated test
            runs
          </li>
          <li>
            <Tag color="orange">Test</Tag> general-purpose testing
          </li>
          <li>
            <Tag color="cyan">Development</Tag> developer workstations and
            internal services
          </li>
          <li>
            <Tag color="magenta">DR</Tag> disaster recovery standby environment
          </li>
          <li>
            <Tag color="geekblue">Lab</Tag> experimental or proof-of-concept
            work
          </li>
        </ul>
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          Auto-created subnets (from Infrastructure Scan) default to{" "}
          <Tag color="red">Production</Tag>. Edit them in the Subnets page to
          adjust.
        </Paragraph>
      </>
    ),
  },

  // ─── IPv6 ─────────────────────────────────────────────────────────────────
  {
    key: "ipv6",
    icon: <GlobalOutlined />,
    title: "IPv6 Dual-Stack",
    content: (
      <>
        <Paragraph>
          The portal supports both <Text strong>IPv4 and IPv6</Text> subnets and
          IP records in the same system.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            Select <Tag color="blue">IPv4</Tag> or{" "}
            <Tag color="purple">IPv6</Tag> when creating a subnet
          </li>
          <li>
            The CIDR must match the selected version — e.g.{" "}
            <Text code>2001:db8::/48</Text> requires IPv6
          </li>
          <li>IPv6 IP records can only be added to IPv6 subnets</li>
          <li>IPv4 and IPv6 subnets nest independently</li>
        </ul>
        <Alert
          type="info"
          showIcon
          style={{ fontSize: 12 }}
          message="The portal accepts both full and compressed IPv6 forms (e.g. 2001:db8::1)."
        />
      </>
    ),
  },

  // ─── Integrations ─────────────────────────────────────────────────────────
  {
    key: "integrations",
    icon: <ApiOutlined />,
    title: "Integrations",
    badge: "Updated",
    content: (
      <>
        <Paragraph>
          The <Text strong>Integrations</Text> page connects the portal to
          external systems for bulk data import. Credentials are used only for
          the duration of the request and are never stored.
        </Paragraph>

        <Paragraph style={{ marginBottom: 4 }}>
          <CloudServerOutlined /> <Text strong>VMware vSphere</Text>
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            Enter vCenter host, username, and password to discover all virtual
            machines
          </li>
          <li>Each VM shows name, OS, power state, and all detected IPs</li>
          <li>
            Select VMs, assign a target subnet and IP per VM, then click{" "}
            <Text strong>Import</Text>
          </li>
          <li>Duplicate IPs in the target subnet are skipped with a warning</li>
        </ul>

        <Paragraph style={{ marginBottom: 4 }}>
          <DatabaseOutlined /> <Text strong>Device42</Text>{" "}
          <Badge
            count="New"
            style={{
              backgroundColor: "#52c41a",
              fontSize: 10,
              height: 16,
              lineHeight: "16px",
              padding: "0 5px",
            }}
          />
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            Enter your Device42 URL, username, and password to pull IP inventory
          </li>
          <li>
            Discovers all IP addresses with their subnet, device name, and MAC
            address
          </li>
          <li>
            Preview results, select the records you want, then click{" "}
            <Text strong>Import</Text>
          </li>
          <li>Already-existing IPs in IPAM are skipped</li>
        </ul>

        <Paragraph style={{ marginBottom: 4 }}>
          <DashboardOutlined style={{ color: "#d4380d" }} />{" "}
          <Text strong>Zabbix</Text>{" "}
          <Badge
            count="New"
            style={{
              backgroundColor: "#52c41a",
              fontSize: 10,
              height: 16,
              lineHeight: "16px",
              padding: "0 5px",
            }}
          />
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            Unlike the other integrations, Zabbix credentials are configured
            once on the server — there's no per-session login form. Just open
            the card and click <Text strong>Discover</Text>.
          </li>
          <li>
            Pulls all monitored hosts and their interfaces from Zabbix and
            matches each IP to an existing subnet automatically
          </li>
          <li>
            Preview results, select the hosts you want, then click{" "}
            <Text strong>Import</Text>
          </li>
          <li>
            Also runs automatically every night (02:35 UTC, after Device42) —
            see below
          </li>
        </ul>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
          message="Nightly automated sync"
          description={
            <>
              Device42 (02:00 UTC), Zabbix (02:35 UTC), and PaloAlto (02:50 UTC)
              all sync automatically every night with no action needed. Device42
              sets the baseline status; Zabbix and PaloAlto can only ever{" "}
              <Text code>upgrade</Text> a record to "In Use" when they have live
              positive evidence — neither marks anything "Free", and neither
              touches a <Tag color="orange">Reserved</Tag> record, so none of
              the three jobs can conflict even if a run window ever grows to
              overlap. Zabbix skips hosts disabled with no data in the last 6
              months (likely decommissioned); PaloAlto only imports named
              single-host (/32) address objects, not the live ARP table or wider
              subnet objects (too noisy for a curated inventory).
            </>
          }
        />

        <Paragraph style={{ marginBottom: 4 }}>
          <SafetyCertificateOutlined /> <Text strong>Palo Alto Networks</Text>{" "}
          <Badge
            count="New"
            style={{
              backgroundColor: "#52c41a",
              fontSize: 10,
              height: 16,
              lineHeight: "16px",
              padding: "0 5px",
            }}
          />
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            Enter the firewall URL, username, password, and virtual system
            (vsys)
          </li>
          <li>
            Discovers all ARP entries from the firewall — IP address, MAC,
            interface, and TTL
          </li>
          <li>Preview, select, and import entries into IPAM</li>
          <li>
            Useful for building an IP inventory from an existing network without
            active scanning
          </li>
          <li>
            For real-time single-IP/subnet lookups instead of bulk import, see
            the dedicated <Text strong>PaloAlto Check</Text> page below.
          </li>
        </ul>

        <Alert
          type="warning"
          showIcon
          style={{ fontSize: 12 }}
          message="Discover / Import on this page requires the SuperAdmin role. Everyone else can see the cards but the action buttons are disabled."
        />
      </>
    ),
  },

  // ─── PaloAlto Check ────────────────────────────────────────────────────────
  {
    key: "paloalto-check",
    icon: <SafetyCertificateOutlined />,
    title: "PaloAlto Check",
    badge: "New",
    content: (
      <>
        <Paragraph>
          A dedicated page for real-time, on-demand PaloAlto lookups — separate
          from the bulk Discover/Import flow on the Integrations page, and from
          the nightly sync. Every check here queries the live firewalls
          directly. <RoleBadge role="Operator" />
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12, fontSize: 12 }}>
          <li>
            <Text strong>Check IP</Text> — searches every configured firewall
            for a named address object, live ARP entry, NAT rule, or security
            policy referencing the address. A match on a rule whose source or
            destination is a <Text strong>/32 or /128 network only</Text> counts
            as evidence of use — a broad-subnet match (e.g. a rule covering a
            whole <Text code>/16</Text>) is shown in the trace log but doesn't
            count, since nearly every address in that range would trivially
            match.
          </li>
          <li>
            <Text strong>Check Subnet</Text> — same check across every host
            address in a CIDR at once
          </li>
          <li>
            <Text strong>Real-time trace log</Text> — streams as the check
            actually runs (Server-Sent Events), so you see exactly which
            firewall is being queried and what it returned, live in the
            terminal-style log panel
          </li>
          <li>
            <Text strong>Reverse DNS hostname</Text> — resolved automatically
            alongside the PaloAlto match
          </li>
          <li>
            <Text strong>Save to IP Records</Text> — turn a found address (or a
            whole batch) into a real IP record with one click, or let the
            nightly sync pick it up automatically
          </li>
          <li>
            <Text strong>30-day check history</Text> — every check made from
            this page, Check Availability, or a bulk scan is logged
            (auto-expires after 30 days); filter by IP to see everything
            recorded for a specific address
          </li>
          <li>
            <Text strong>30-day PAN-OS traffic logs</Text> — pulls PaloAlto's
            own historical traffic/session logs for the address directly from
            the firewall (not IPAM's own check history) — genuine evidence of
            real recent network activity, not just "IPAM checked it once"
          </li>
        </ul>
      </>
    ),
  },

  // ─── DNS Conflict Detection ───────────────────────────────────────────────
  {
    key: "dns-conflicts",
    icon: <BugOutlined />,
    title: "DNS Conflict Detection",
    content: (
      <>
        <Paragraph>
          The <Text strong>DNS Conflict Scanner</Text> checks IP records in a
          subnet against live DNS to detect inconsistencies.
        </Paragraph>
        <Paragraph style={{ marginBottom: 4 }}>
          <Text strong>Conflict types detected:</Text>
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            <Tag color="orange">FORWARD_MISMATCH</Tag> — hostname resolves to a
            different IP address
          </li>
          <li>
            <Tag color="gold">PTR_MISMATCH</Tag> — reverse (PTR) lookup returns
            a different hostname
          </li>
          <li>
            <Tag color="red">NO_FORWARD</Tag> — hostname has no DNS record at
            all
          </li>
          <li>
            <Tag color="volcano">DUPLICATE_HOSTNAME</Tag> — same hostname
            assigned to two or more IP records in the subnet
          </li>
        </ul>
        <Paragraph>
          IP records without a hostname are skipped. To run a scan, open any
          subnet's detail panel and click <Text strong>Scan Conflicts</Text>.
        </Paragraph>
        <Alert
          type="warning"
          showIcon
          style={{ fontSize: 12 }}
          message="Results are not stored — re-run the scan to refresh."
        />
      </>
    ),
  },

  // ─── LDAP ─────────────────────────────────────────────────────────────────
  {
    key: "ldap",
    icon: <SafetyCertificateOutlined />,
    title: "LDAP / AD Authentication",
    content: (
      <>
        <Paragraph>
          When enabled by an administrator, users can log in with their{" "}
          <Text strong>Active Directory or LDAP credentials</Text> — no separate
          IPAM password required.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            LDAP login is configured server-side via environment variables
          </li>
          <li>
            First-time LDAP login auto-provisions the user with the{" "}
            <Tag>Viewer</Tag> role
          </li>
          <li>
            Administrators can promote LDAP users to Operator or Administrator
          </li>
          <li>LDAP users cannot use the "Change Password" feature</li>
        </ul>
        <Alert
          type="info"
          showIcon
          style={{ fontSize: 12 }}
          message='When LDAP is active, an "LDAP/AD Authentication Enabled" badge is shown on the login page.'
        />
      </>
    ),
  },

  // ─── Audit Log ────────────────────────────────────────────────────────────
  {
    key: "audit-log",
    icon: <AuditOutlined />,
    title: "Audit Log",
    content: (
      <>
        <Paragraph>
          The <Text strong>Audit Log</Text> page (sidebar → Audit Log) shows
          every write action taken by any user across the entire system — a
          full, tamper-evident activity record.
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>Filter by username, action type, resource type, or date range</li>
          <li>
            Each entry shows: timestamp, user, action, resource type, resource
            ID, and a human-readable summary
          </li>
          <li>For updates, the full before/after field diff is available</li>
        </ul>
        <Alert
          type="info"
          showIcon
          style={{ fontSize: 12 }}
          message="Audit Log access requires Administrator role."
        />
      </>
    ),
  },

  // ─── User Roles ───────────────────────────────────────────────────────────
  {
    key: "roles",
    icon: <TeamOutlined />,
    title: "User Roles & Permissions",
    badge: "Updated",
    content: (
      <>
        <Paragraph>
          Access is controlled by four hierarchical roles. Unlike the old model,{" "}
          <Text strong>Operator is deliberately read-only</Text> on core IPAM
          data — it's a "look and actively scan" role, not a "look and edit"
          role:
        </Paragraph>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            <Space size={4}>
              <EyeOutlined style={{ color: "#8c8c8c" }} />
              <Text strong>Viewer</Text>
            </Space>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Read-only — Dashboard, IP Records, Subnets, Unused IP Addresses
              (and the other core IPAM pages), full change history.
            </Text>
          </li>
          <li style={{ marginTop: 8 }}>
            <Space size={4}>
              <ScanOutlined style={{ color: "#1677ff" }} />
              <Text strong>Operator</Text>
            </Space>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              All Viewer access, still read-only on IP Records/Subnets (no
              create, edit, reserve/release, or Check Availability) —{" "}
              <Text strong>plus</Text> the ability to actually run and use{" "}
              <Text strong>PaloAlto Check</Text> (single/subnet scans) and{" "}
              <Text strong>Network Scan</Text>, export IP Records to CSV, and
              view Show Duplicates. Can open the{" "}
              <Text strong>Integrations</Text> page and see everything on it,
              but the Discover/Import action buttons are disabled.
            </Text>
          </li>
          <li style={{ marginTop: 8 }}>
            <Space size={4}>
              <LockOutlined style={{ color: "#ff4d4f" }} />
              <Text strong>Administrator</Text>
            </Space>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Full read/write access everywhere — create/edit/delete subnets and
              IP records, reserve/release, bulk operations, the merged Check
              Availability scan and Bulk Scan, Scan in PaloAlto, user
              management, pending approvals, and the full audit log. The one
              exception: like Operator, can see the Integrations page but{" "}
              <Text strong>cannot</Text> use its Discover/Import actions.
            </Text>
          </li>
          <li style={{ marginTop: 8 }}>
            <Space size={4}>
              <SafetyCertificateOutlined style={{ color: "#faad14" }} />
              <Text strong>SuperAdmin</Text>
            </Space>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Bypasses every role check, with no per-page exceptions — the only
              role that can actually run Integrations Discover/Import (vSphere,
              Device42, Zabbix, PaloAlto) and delete a Vault cabinet.
            </Text>
          </li>
        </ul>
        <Alert
          type="info"
          showIcon
          style={{ fontSize: 12 }}
          message='Roles are hierarchical for what they include, but "higher" is not strictly "more of the same" — Operator trades edit rights on IPAM data for hands-on scanning tools, and even Administrator is deliberately locked out of Integrations actions.'
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
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? ALL_SECTIONS.filter(
        (s) =>
          s.title.toLowerCase().includes(search.toLowerCase()) ||
          s.key.toLowerCase().includes(search.toLowerCase()),
      )
    : ALL_SECTIONS;

  return (
    <Drawer
      title="IPAM Concepts & Help"
      open={open}
      onClose={() => {
        setSearch("");
        onClose();
      }}
      width={540}
      styles={{ body: { paddingTop: 12 } }}
    >
      <Input
        prefix={<SearchOutlined style={{ color: "#8c8c8c" }} />}
        placeholder="Search topics…"
        allowClear
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16 }}
      />

      {filtered.length === 0 ? (
        <Typography.Text type="secondary">
          No topics match "{search}"
        </Typography.Text>
      ) : (
        <Collapse
          accordion={false}
          defaultActiveKey={["dashboard"]}
          expandIconPosition="end"
          items={filtered.map((section) => ({
            key: section.key,
            label: (
              <Space size={8}>
                <span style={{ color: "#1677ff", fontSize: 15 }}>
                  {section.icon}
                </span>
                <Text strong style={{ fontSize: 14 }}>
                  {section.title}
                </Text>
                {section.badge && (
                  <Badge
                    count={section.badge}
                    style={{
                      backgroundColor:
                        section.badge === "New"
                          ? "#52c41a"
                          : section.badge === "Updated"
                            ? "#1677ff"
                            : "#faad14",
                      fontSize: 10,
                      height: 16,
                      lineHeight: "16px",
                      padding: "0 5px",
                    }}
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

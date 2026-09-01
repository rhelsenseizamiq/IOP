import React, { useMemo, useEffect, useState } from "react";
import { Menu, Badge } from "antd";
import type { MenuProps } from "antd";
import {
  HomeOutlined,
  DashboardOutlined,
  GlobalOutlined,
  ApartmentOutlined,
  ScanOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  AuditOutlined,
  DatabaseOutlined,
  ApiOutlined,
  UserAddOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { usersApi } from "../../api/users";

type MenuItem = Required<MenuProps>["items"][number];

interface Props {
  collapsed: boolean;
}

const Sidebar: React.FC<Props> = ({ collapsed }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!hasRole("Administrator")) return;
    usersApi
      .pending({ page: 1, page_size: 1 })
      .then((res) => setPendingCount(res.data.total))
      .catch(() => {
        /* non-critical */
      });
  }, [hasRole]);

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (path === "/") return "/";
    if (path.startsWith("/ip-records")) return "/ip-records";
    if (path.startsWith("/unused-ips")) return "/unused-ips";
    if (path.startsWith("/subnets")) return "/subnets";
    if (path.startsWith("/vrfs")) return "/vrfs";
    if (path.startsWith("/aggregates")) return "/aggregates";
    if (path.startsWith("/assets")) return "/assets";
    if (path.startsWith("/network-scan")) return "/network-scan";
    if (path.startsWith("/paloalto-check")) return "/paloalto-check";
    if (path.startsWith("/integrations")) return "/integrations";
    if (path.startsWith("/users")) return "/users";
    if (path.startsWith("/pending-approvals")) return "/pending-approvals";
    if (path.startsWith("/audit-log")) return "/audit-log";
    return "/dashboard";
  }, [location.pathname]);

  const menuItems = useMemo((): MenuItem[] => {
    const items: MenuItem[] = [
      {
        key: "/",
        icon: <HomeOutlined />,
        label: "Home",
      },
      {
        key: "/dashboard",
        icon: <DashboardOutlined />,
        label: "Dashboard",
      },
      {
        key: "ipam-group",
        icon: <DatabaseOutlined />,
        label: "IPAM",
        children: [
          {
            key: "/ip-records",
            icon: <GlobalOutlined />,
            label: "IP Records",
          },
          {
            key: "/subnets",
            icon: <ApartmentOutlined />,
            label: "Subnets",
          },
          {
            key: "/unused-ips",
            icon: <UnorderedListOutlined />,
            label: "Unused IP Addresses",
          },
          // VRFs / Aggregates / Assets — disabled, currently unused.
          // Re-enable by uncommenting these entries + the matching routes
          // in App.tsx and this file's selectedKey logic above.
          // {
          //   key: "/vrfs",
          //   icon: <ClusterOutlined />,
          //   label: "VRFs",
          // },
          // {
          //   key: "/aggregates",
          //   icon: <DatabaseOutlined />,
          //   label: "Aggregates",
          // },
          // {
          //   key: "/assets",
          //   icon: <HddOutlined />,
          //   label: "Assets",
          // },
        ],
      },
    ];

    if (hasRole("Operator")) {
      items.push(
        {
          key: "/network-scan",
          icon: <ScanOutlined />,
          label: "Network Scan",
        },
        {
          key: "/paloalto-check",
          icon: <SafetyCertificateOutlined />,
          label: "PaloAlto Check",
        },
        {
          key: "/integrations",
          icon: <ApiOutlined />,
          label: "Integrations",
        },
      );
    }

    if (hasRole("Administrator")) {
      items.push(
        {
          key: "/users",
          icon: <TeamOutlined />,
          label: "Users",
        },
        {
          key: "/pending-approvals",
          icon: <UserAddOutlined />,
          label: (
            <span
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              Pending Approvals
              {pendingCount > 0 && <Badge count={pendingCount} size="small" />}
            </span>
          ),
        },
        {
          key: "/audit-log",
          icon: <AuditOutlined />,
          label: "Audit Log",
        },
      );
    }

    return items;
  }, [hasRole, pendingCount]);

  return (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selectedKey]}
      defaultOpenKeys={["ipam-group"]}
      inlineCollapsed={collapsed}
      items={menuItems}
      onClick={({ key }) => {
        if (key !== "ipam-group") navigate(key);
      }}
      style={{ borderRight: 0, flex: 1 }}
    />
  );
};

export default Sidebar;

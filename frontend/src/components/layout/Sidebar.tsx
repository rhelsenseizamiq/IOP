import React, { useMemo } from 'react';
import { Menu } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  GlobalOutlined,
  ApartmentOutlined,
  ScanOutlined,
  TeamOutlined,
  AuditOutlined,
  ClusterOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

type MenuItem = Required<MenuProps>['items'][number];

interface Props {
  collapsed: boolean;
}

const Sidebar: React.FC<Props> = ({ collapsed }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/ip-records')) return '/ip-records';
    if (path.startsWith('/subnets')) return '/subnets';
    if (path.startsWith('/vrfs')) return '/vrfs';
    if (path.startsWith('/aggregates')) return '/aggregates';
    if (path.startsWith('/network-scan')) return '/network-scan';
    if (path.startsWith('/users')) return '/users';
    if (path.startsWith('/audit-log')) return '/audit-log';
    return '/dashboard';
  }, [location.pathname]);

  const menuItems = useMemo((): MenuItem[] => {
    const items: MenuItem[] = [
      {
        key: '/dashboard',
        icon: <DashboardOutlined />,
        label: 'Dashboard',
      },
      {
        key: 'ipam-group',
        icon: <DatabaseOutlined />,
        label: 'IPAM',
        children: [
          {
            key: '/ip-records',
            icon: <GlobalOutlined />,
            label: 'IP Records',
          },
          {
            key: '/subnets',
            icon: <ApartmentOutlined />,
            label: 'Subnets',
          },
          {
            key: '/vrfs',
            icon: <ClusterOutlined />,
            label: 'VRFs',
          },
          {
            key: '/aggregates',
            icon: <DatabaseOutlined />,
            label: 'Aggregates',
          },
        ],
      },
    ];

    if (hasRole('Operator')) {
      items.push({
        key: '/network-scan',
        icon: <ScanOutlined />,
        label: 'Network Scan',
      });
    }

    if (hasRole('Administrator')) {
      items.push(
        {
          key: '/users',
          icon: <TeamOutlined />,
          label: 'Users',
        },
        {
          key: '/audit-log',
          icon: <AuditOutlined />,
          label: 'Audit Log',
        }
      );
    }

    return items;
  }, [hasRole]);

  return (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selectedKey]}
      defaultOpenKeys={['ipam-group']}
      inlineCollapsed={collapsed}
      items={menuItems}
      onClick={({ key }) => {
        if (key !== 'ipam-group') navigate(key);
      }}
      style={{ borderRight: 0, flex: 1 }}
    />
  );
};

export default Sidebar;

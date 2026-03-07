import React, { useState } from 'react';
import { Layout, Button, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import Sidebar from './Sidebar';
import AppHeader from './Header';
import HelpDrawer from './HelpDrawer';

const { Sider, Header, Content } = Layout;

const SIDER_WIDTH = 220;
const SIDER_COLLAPSED_WIDTH = 64;

const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={SIDER_WIDTH}
        collapsedWidth={SIDER_COLLAPSED_WIDTH}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
        }}
        theme="dark"
      >
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 16px',
            color: '#fff',
            fontWeight: 700,
            fontSize: collapsed ? 14 : 16,
            letterSpacing: 0.5,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {collapsed ? 'IP' : 'IPAM Portal'}
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          <Sidebar collapsed={collapsed} />
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.1)',
            padding: collapsed ? '12px 0' : '12px 16px',
            display: 'flex',
            justifyContent: collapsed ? 'center' : 'flex-start',
            flexShrink: 0,
          }}
        >
          <Tooltip title="Help & Concepts" placement="right">
            <Button
              type="text"
              icon={<QuestionCircleOutlined />}
              onClick={() => setHelpOpen(true)}
              style={{
                color: 'rgba(255,255,255,0.65)',
                padding: collapsed ? '4px 8px' : '4px 0',
              }}
            >
              {collapsed ? null : 'Help & Concepts'}
            </Button>
          </Tooltip>
        </div>
      </Sider>

      <Layout
        style={{
          marginLeft: collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH,
          transition: 'margin-left 0.2s',
        }}
      >
        <Header
          style={{
            padding: 0,
            background: '#fff',
            position: 'sticky',
            top: 0,
            zIndex: 99,
            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          }}
        >
          <AppHeader />
        </Header>

        <Content
          style={{
            margin: '24px 24px 0',
            overflow: 'initial',
          }}
        >
          <div
            style={{
              padding: 24,
              minHeight: 'calc(100vh - 112px)',
              background: '#fff',
              borderRadius: 8,
            }}
          >
            {children}
          </div>
        </Content>
      </Layout>

      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </Layout>
  );
};

export default AppLayout;

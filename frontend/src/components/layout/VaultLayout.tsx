import React, { useState } from "react";
import { Layout, Button, Tooltip } from "antd";
import {
  BankOutlined,
  HomeOutlined,
  KeyOutlined,
  QuestionCircleOutlined,
  LockOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import AppHeader from "./Header";
import VaultHelpDrawer from "./VaultHelpDrawer";

const { Sider, Header, Content } = Layout;

const SIDER_WIDTH = 200;
const SIDER_COLLAPSED_WIDTH = 64;

const VaultLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: "100vh", background: "#1e1e28" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={SIDER_WIDTH}
        collapsedWidth={SIDER_COLLAPSED_WIDTH}
        style={{
          height: "100vh",
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          background: "#16161f",
        }}
        theme="dark"
      >
        {/* Vault header */}
        <div
          style={{
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? 0 : "0 16px",
            gap: 8,
            color: "#70c0e8",
            fontWeight: 700,
            fontSize: collapsed ? 13 : 15,
            letterSpacing: 0.5,
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <LockOutlined style={{ fontSize: 16, flexShrink: 0 }} />
          {!collapsed && "Password Vault"}
        </div>

        {/* Nav items */}
        <div style={{ padding: "8px 0" }}>
          <Tooltip title="Cabinets" placement="right">
            <Button
              type="text"
              icon={<BankOutlined />}
              onClick={() => navigate("/vault")}
              style={{
                color: "rgba(255,255,255,0.85)",
                padding: collapsed ? "4px 8px" : "4px 16px",
                justifyContent: collapsed ? "center" : "flex-start",
                width: "100%",
                fontWeight: 500,
              }}
            >
              {collapsed ? null : "Cabinets"}
            </Button>
          </Tooltip>
          <Tooltip title="Password Generator" placement="right">
            <Button
              type="text"
              icon={<KeyOutlined />}
              onClick={() => navigate("/vault/generator")}
              style={{
                color: "rgba(255,255,255,0.85)",
                padding: collapsed ? "4px 8px" : "4px 16px",
                justifyContent: collapsed ? "center" : "flex-start",
                width: "100%",
                fontWeight: 500,
              }}
            >
              {collapsed ? null : "Generator"}
            </Button>
          </Tooltip>
        </div>

        <div style={{ flex: 1 }} />

        {/* Bottom actions */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
            padding: collapsed ? "12px 0" : "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <Tooltip title="Home" placement="right">
            <Button
              type="text"
              icon={<HomeOutlined />}
              onClick={() => navigate("/")}
              style={{
                color: "rgba(255,255,255,0.65)",
                padding: collapsed ? "4px 8px" : "4px 0",
                justifyContent: collapsed ? "center" : "flex-start",
                width: "100%",
              }}
            >
              {collapsed ? null : "Home"}
            </Button>
          </Tooltip>

          <Tooltip title="PassManager Concepts & Help" placement="right">
            <Button
              type="text"
              icon={<QuestionCircleOutlined />}
              onClick={() => setHelpOpen(true)}
              style={{
                color: "rgba(255,255,255,0.65)",
                padding: collapsed ? "4px 8px" : "4px 0",
                justifyContent: collapsed ? "center" : "flex-start",
                width: "100%",
              }}
            >
              {collapsed ? null : "Help & Concepts"}
            </Button>
          </Tooltip>
        </div>
      </Sider>

      <Layout
        style={{
          marginLeft: collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH,
          transition: "margin-left 0.2s",
          background: "#1e1e28",
        }}
      >
        <Header
          style={{
            padding: 0,
            background: "#16161f",
            position: "sticky",
            top: 0,
            zIndex: 99,
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <AppHeader />
        </Header>

        <Content
          style={{
            margin: "20px 20px 0",
            overflow: "initial",
          }}
        >
          <div
            style={{
              padding: 24,
              minHeight: "calc(100vh - 112px)",
              background: "#252530",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {children}
          </div>
        </Content>
      </Layout>

      <VaultHelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </Layout>
  );
};

export default VaultLayout;

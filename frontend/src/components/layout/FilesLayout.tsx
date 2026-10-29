import React, { useState } from "react";
import { Layout, Button, Tooltip } from "antd";
import { FileOutlined, HomeOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import AppHeader from "./Header";

const { Sider, Header, Content } = Layout;

const SIDER_WIDTH = 200;
const SIDER_COLLAPSED_WIDTH = 64;

const FilesLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
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
        <div
          style={{
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? 0 : "0 16px",
            gap: 8,
            color: "#e8a33d",
            fontWeight: 700,
            fontSize: collapsed ? 13 : 15,
            letterSpacing: 0.5,
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <FileOutlined style={{ fontSize: 16, flexShrink: 0 }} />
          {!collapsed && "File Sharing"}
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
            padding: collapsed ? "12px 0" : "12px 16px",
            display: "flex",
            justifyContent: collapsed ? "center" : "flex-start",
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
    </Layout>
  );
};

export default FilesLayout;

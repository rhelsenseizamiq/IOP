import React, { useState } from "react";
import {
  Space,
  Tag,
  Button,
  Dropdown,
  Modal,
  Form,
  Input,
  message,
  Typography,
} from "antd";
import {
  LogoutOutlined,
  UserOutlined,
  KeyOutlined,
  DownOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../api/auth";
import type { Role } from "../../types/auth";

const ROLE_COLOR: Record<Role, string> = {
  Viewer: "default",
  Operator: "blue",
  Administrator: "red",
  SuperAdmin: "purple",
};

interface ChangePasswordFormValues {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

const AppHeader: React.FC = () => {
  const { fullName, role, logout } = useAuth();
  const navigate = useNavigate();
  const [changePwVisible, setChangePwVisible] = useState(false);
  const [changePwLoading, setChangePwLoading] = useState(false);
  const [form] = Form.useForm<ChangePasswordFormValues>();

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate("/login", { replace: true });
  };

  const handleChangePassword = async (
    values: ChangePasswordFormValues,
  ): Promise<void> => {
    setChangePwLoading(true);
    try {
      await authApi.changePassword({
        current_password: values.current_password,
        new_password: values.new_password,
      });
      message.success("Password changed successfully");
      setChangePwVisible(false);
      form.resetFields();
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      message.error(
        axiosErr.response?.data?.detail ??
          axiosErr.message ??
          "Failed to change password",
      );
    } finally {
      setChangePwLoading(false);
    }
  };

  const menuItems = [
    {
      key: "change-password",
      icon: <KeyOutlined />,
      label: "Change Password",
      onClick: () => setChangePwVisible(true),
    },
    { type: "divider" as const },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "Logout",
      danger: true,
      onClick: handleLogout,
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        height: "100%",
        padding: "0 24px",
        gap: 12,
      }}
    >
      <Space align="center" size={12}>
        {role && <Tag color={ROLE_COLOR[role]}>{role}</Tag>}
        <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
          <Button
            type="text"
            icon={<UserOutlined />}
            style={{ fontWeight: 500 }}
          >
            <Typography.Text strong>{fullName}</Typography.Text>
            <DownOutlined style={{ marginLeft: 4, fontSize: 11 }} />
          </Button>
        </Dropdown>
      </Space>

      <Modal
        title="Change Password"
        open={changePwVisible}
        onCancel={() => {
          setChangePwVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="Change Password"
        confirmLoading={changePwLoading}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleChangePassword}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="Current Password"
            name="current_password"
            rules={[
              { required: true, message: "Please enter current password" },
            ]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            label="New Password"
            name="new_password"
            rules={[
              { required: true, message: "Please enter new password" },
              { min: 8, message: "Password must be at least 8 characters" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="Confirm New Password"
            name="confirm_password"
            dependencies={["new_password"]}
            rules={[
              { required: true, message: "Please confirm new password" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("new_password") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("Passwords do not match"));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AppHeader;

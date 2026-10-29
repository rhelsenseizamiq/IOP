import React, { useState } from "react";
import {
  Form,
  Input,
  Button,
  Card,
  Alert,
  Typography,
  Space,
  Result,
} from "antd";
import { UserOutlined, LockOutlined, MailOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../api/auth";
import type { RegisterRequest } from "../../types/user";

interface RegistrationFormValues {
  username: string;
  full_name: string;
  email?: string;
  password: string;
  confirm_password: string;
  note?: string;
}

const RegistrationPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (
    values: RegistrationFormValues,
  ): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const payload: RegisterRequest = {
        username: values.username,
        password: values.password,
        full_name: values.full_name,
        email: values.email || undefined,
        note: values.note || undefined,
      };
      await authApi.register(payload);
      setSubmitted(true);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { status?: number; data?: { detail?: string } };
        message?: string;
      };
      const detail = axiosErr.response?.data?.detail;
      if (typeof detail === "string") {
        setErrorMsg(detail);
      } else if (axiosErr.response?.status === 429) {
        setErrorMsg("Too many requests. Please try again in a minute.");
      } else {
        setErrorMsg(
          axiosErr.message ?? "Registration failed. Please try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1e1e28",
      }}
    >
      <Card
        style={{
          width: 440,
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          borderRadius: 12,
        }}
        bodyStyle={{ padding: "40px 40px 32px" }}
      >
        {submitted ? (
          <Result
            status="success"
            title="Registration Submitted!"
            subTitle="An administrator will review your request. You will be able to log in once approved."
            extra={
              <Button type="primary" onClick={() => navigate("/login")}>
                Back to Login
              </Button>
            }
          />
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size={24}>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  background:
                    "linear-gradient(135deg, #18a058 0%, #36ad6a 100%)",
                  borderRadius: 10,
                  padding: "8px 20px",
                  display: "inline-flex",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: 22,
                    letterSpacing: 4,
                  }}
                >
                  IOP
                </span>
              </div>
              <Typography.Text type="secondary">Request Access</Typography.Text>
            </div>

            {errorMsg && (
              <Alert
                message={errorMsg}
                type="error"
                showIcon
                closable
                onClose={() => setErrorMsg(null)}
              />
            )}

            <Form
              name="registration"
              onFinish={handleSubmit}
              layout="vertical"
              size="large"
              autoComplete="on"
            >
              <Form.Item
                name="username"
                label="Username"
                rules={[
                  { required: true, message: "Please enter a username" },
                  { min: 3, message: "At least 3 characters" },
                  { max: 50, message: "At most 50 characters" },
                  {
                    pattern: /^[a-zA-Z0-9_.-]+$/,
                    message: "Only letters, digits, _, -, . allowed",
                  },
                ]}
              >
                <Input
                  prefix={<UserOutlined style={{ color: "#bfbfbf" }} />}
                  placeholder="Username"
                  autoComplete="username"
                  autoFocus
                />
              </Form.Item>

              <Form.Item
                name="full_name"
                label="Full Name"
                rules={[
                  { required: true, message: "Please enter your full name" },
                  { max: 100, message: "At most 100 characters" },
                ]}
              >
                <Input placeholder="Full Name" autoComplete="name" />
              </Form.Item>

              <Form.Item
                name="email"
                label="Email (optional)"
                rules={[
                  {
                    type: "email",
                    message: "Please enter a valid email address",
                  },
                ]}
              >
                <Input
                  prefix={<MailOutlined style={{ color: "#bfbfbf" }} />}
                  placeholder="email@example.com"
                  autoComplete="email"
                />
              </Form.Item>

              <Form.Item
                name="password"
                label="Password"
                rules={[
                  { required: true, message: "Please enter a password" },
                  { min: 8, message: "At least 8 characters" },
                  { max: 128, message: "At most 128 characters" },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: "#bfbfbf" }} />}
                  placeholder="Password"
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item
                name="confirm_password"
                label="Confirm Password"
                dependencies={["password"]}
                rules={[
                  { required: true, message: "Please confirm your password" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(
                        new Error("Passwords do not match"),
                      );
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: "#bfbfbf" }} />}
                  placeholder="Confirm Password"
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item
                name="note"
                label="Note (optional)"
                rules={[{ max: 500, message: "At most 500 characters" }]}
              >
                <Input.TextArea
                  placeholder="Tell us who you are or why you need access"
                  rows={3}
                  maxLength={500}
                  showCount
                />
              </Form.Item>

              <Form.Item style={{ marginBottom: 0 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  block
                  style={{ height: 44, borderRadius: 6 }}
                >
                  Submit Registration
                </Button>
              </Form.Item>
            </Form>

            <div style={{ textAlign: "center" }}>
              <Typography.Link onClick={() => navigate("/login")}>
                Back to Login
              </Typography.Link>
            </div>
          </Space>
        )}
      </Card>
    </div>
  );
};

export default RegistrationPage;

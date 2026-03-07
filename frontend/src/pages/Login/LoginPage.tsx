import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Alert, Typography, Space, Tag } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { authApi } from '../../api/auth';

interface LoginFormValues {
  username: string;
  password: string;
}

interface LocationState {
  from?: { pathname: string };
}

const LoginPage: React.FC = () => {
  const { login, isAuthenticated, isInitializing } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ldapEnabled, setLdapEnabled] = useState(false);

  useEffect(() => {
    authApi.config()
      .then((res) => setLdapEnabled(res.data.ldap_enabled))
      .catch(() => {/* non-critical */});
  }, []);

  const from = (location.state as LocationState)?.from?.pathname ?? '/dashboard';

  if (!isInitializing && isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (values: LoginFormValues): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await login(values.username, values.password);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } }; message?: string };
      const detail = axiosErr.response?.data?.detail;
      if (typeof detail === 'string') {
        setErrorMsg(detail);
      } else if (axiosErr.response?.status === 401) {
        setErrorMsg('Invalid username or password');
      } else {
        setErrorMsg(axiosErr.message ?? 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #001529 0%, #003366 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          borderRadius: 12,
        }}
        bodyStyle={{ padding: '40px 40px 32px' }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={24}>
          <div style={{ textAlign: 'center' }}>
            <Typography.Title level={3} style={{ margin: 0, color: '#001529' }}>
              IPAM Portal
            </Typography.Title>
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">IP Address Management System</Typography.Text>
              {ldapEnabled && (
                <Tag color="purple" style={{ margin: 0 }}>
                  LDAP/AD Authentication Enabled
                </Tag>
              )}
            </Space>
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
            name="login"
            onFinish={handleSubmit}
            layout="vertical"
            size="large"
            autoComplete="on"
          >
            <Form.Item
              name="username"
              label="Username"
              rules={[{ required: true, message: 'Please enter your username' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="Username"
                autoComplete="username"
                autoFocus
              />
            </Form.Item>

            <Form.Item
              name="password"
              label="Password"
              rules={[{ required: true, message: 'Please enter your password' }]}
              style={{ marginBottom: 24 }}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="Password"
                autoComplete="current-password"
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
                Sign In
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  );
};

export default LoginPage;

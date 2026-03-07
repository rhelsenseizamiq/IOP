import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Result, Button } from 'antd';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/Login/LoginPage';
import DashboardPage from './pages/Dashboard/DashboardPage';
import IPRecordsPage from './pages/IPRecords/IPRecordsPage';
import SubnetsPage from './pages/Subnets/SubnetsPage';
import NetworkScanPage from './pages/NetworkScan/NetworkScanPage';
import UsersPage from './pages/Users/UsersPage';
import AuditLogPage from './pages/AuditLog/AuditLogPage';
import VRFsPage from './pages/VRFs/VRFsPage';
import AggregatesPage from './pages/Aggregates/AggregatesPage';
import IntegrationsPage from './pages/Integrations/IntegrationsPage';

const UnauthorizedPage: React.FC = () => (
  <div
    style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <Result
      status="403"
      title="Access Denied"
      subTitle="You do not have permission to access this page."
      extra={
        <Button type="primary" href="/dashboard">
          Back to Dashboard
        </Button>
      }
    />
  </div>
);

const App: React.FC = () => (
  <ConfigProvider
    theme={{
      token: {
        colorPrimary: '#1677ff',
        borderRadius: 6,
      },
    }}
  >
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          {/* Redirect root to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* Protected routes — all wrapped in AppLayout */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requiredRole="Viewer">
                <AppLayout>
                  <DashboardPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/ip-records"
            element={
              <ProtectedRoute requiredRole="Viewer">
                <AppLayout>
                  <IPRecordsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/subnets"
            element={
              <ProtectedRoute requiredRole="Viewer">
                <AppLayout>
                  <SubnetsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/vrfs"
            element={
              <ProtectedRoute requiredRole="Viewer">
                <AppLayout>
                  <VRFsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/aggregates"
            element={
              <ProtectedRoute requiredRole="Operator">
                <AppLayout>
                  <AggregatesPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/network-scan"
            element={
              <ProtectedRoute requiredRole="Operator">
                <AppLayout>
                  <NetworkScanPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/integrations"
            element={
              <ProtectedRoute requiredRole="Operator">
                <AppLayout>
                  <IntegrationsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/users"
            element={
              <ProtectedRoute requiredRole="Administrator">
                <AppLayout>
                  <UsersPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/audit-log"
            element={
              <ProtectedRoute requiredRole="Administrator">
                <AppLayout>
                  <AuditLogPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          {/* Catch-all: redirect unknown paths to dashboard */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </ConfigProvider>
);

export default App;

import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider, Result, Button, Spin, theme } from "antd";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import LoginPage from "./pages/Login/LoginPage";
import HomePage from "./pages/Home/HomePage";
import DashboardPage from "./pages/Dashboard/DashboardPage";
import IPRecordsPage from "./pages/IPRecords/IPRecordsPage";
import SubnetsPage from "./pages/Subnets/SubnetsPage";
import NetworkScanPage from "./pages/NetworkScan/NetworkScanPage";
import PaloAltoCheckPage from "./pages/PaloAltoCheck/PaloAltoCheckPage";
import UsersPage from "./pages/Users/UsersPage";
import AuditLogPage from "./pages/AuditLog/AuditLogPage";
// VRFsPage / AggregatesPage / AssetsPage — disabled, currently unused.
// Re-enable by restoring these imports along with their <Route> elements.
import IntegrationsPage from "./pages/Integrations/IntegrationsPage";
import VaultPage from "./pages/Vault/VaultPage";
import VaultLayout from "./components/layout/VaultLayout";
import RegistrationPage from "./pages/Registration/RegistrationPage";
import PendingApprovalsPage from "./pages/Users/PendingApprovalsPage";
import UnusedIPsPage from "./pages/UnusedIPs/UnusedIPsPage";

const SharePage = lazy(() => import("./pages/Share/SharePage"));
const PasswordGeneratorPage = lazy(
  () => import("./pages/Vault/PasswordGeneratorPage"),
);

const UnauthorizedPage: React.FC = () => (
  <div
    style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
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
      algorithm: theme.darkAlgorithm,
      token: {
        colorPrimary: "#63e2b7",
        colorBgBase: "#1e1e28",
        colorBgContainer: "#252530",
        colorBgElevated: "#2a2a38",
        borderRadius: 8,
      },
    }}
  >
    <AuthProvider>
      <BrowserRouter>
        <Suspense
          fallback={
            <div
              style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Spin size="large" />
            </div>
          }
        >
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegistrationPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />
            <Route path="/share/:token" element={<SharePage />} />

            {/* Home page — portal selector */}
            <Route
              path="/"
              element={
                <ProtectedRoute requiredRole="Viewer">
                  <HomePage />
                </ProtectedRoute>
              }
            />

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
              path="/unused-ips"
              element={
                <ProtectedRoute requiredRole="Viewer">
                  <AppLayout>
                    <UnusedIPsPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            {/* VRFs / Aggregates / Assets — disabled, currently unused.
                Re-enable by restoring the original <Route> elements below
                (see git history) and the matching Sidebar.tsx nav entries. */}
            <Route
              path="/vrfs"
              element={<Navigate to="/dashboard" replace />}
            />

            <Route
              path="/aggregates"
              element={<Navigate to="/dashboard" replace />}
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
              path="/paloalto-check"
              element={
                <ProtectedRoute requiredRole="Operator">
                  <AppLayout>
                    <PaloAltoCheckPage />
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

            <Route
              path="/pending-approvals"
              element={
                <ProtectedRoute requiredRole="Administrator">
                  <AppLayout>
                    <PendingApprovalsPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            {/* Assets — disabled, currently unused. Re-enable by restoring
                the original <Route> element (see git history) and the
                matching Sidebar.tsx nav entry. */}
            <Route
              path="/assets"
              element={<Navigate to="/dashboard" replace />}
            />

            <Route
              path="/vault"
              element={
                <ProtectedRoute requiredRole="Viewer">
                  <VaultLayout>
                    <VaultPage />
                  </VaultLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/vault/generator"
              element={
                <ProtectedRoute requiredRole="Viewer">
                  <VaultLayout>
                    <PasswordGeneratorPage />
                  </VaultLayout>
                </ProtectedRoute>
              }
            />

            {/* Catch-all: redirect unknown paths to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  </ConfigProvider>
);

export default App;

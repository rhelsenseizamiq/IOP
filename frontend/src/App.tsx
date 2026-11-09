import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider, Result, Button, Spin, theme } from "antd";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import LoginPage from "./pages/Login/LoginPage";
import HomePage from "./pages/Home/HomePage";
import VaultLayout from "./components/layout/VaultLayout";
import FilesLayout from "./components/layout/FilesLayout";

// Every other page is route-based code-split: each becomes its own JS
// chunk, fetched only when that route is actually visited, instead of
// all of them (including heavy deps like recharts, pulled in by
// DashboardPage) landing in one ~2.2MB main bundle every visitor
// downloads up front regardless of which pages they ever open.
const DashboardPage = lazy(() => import("./pages/Dashboard/DashboardPage"));
const IPRecordsPage = lazy(() => import("./pages/IPRecords/IPRecordsPage"));
const SubnetsPage = lazy(() => import("./pages/Subnets/SubnetsPage"));
const NetworkScanPage = lazy(() => import("./pages/NetworkScan/NetworkScanPage"));
const PaloAltoCheckPage = lazy(() => import("./pages/PaloAltoCheck/PaloAltoCheckPage"));
const UsersPage = lazy(() => import("./pages/Users/UsersPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLog/AuditLogPage"));
// VRFsPage / AggregatesPage / AssetsPage — disabled, currently unused.
// Re-enable by restoring these imports along with their <Route> elements.
const IntegrationsPage = lazy(() => import("./pages/Integrations/IntegrationsPage"));
const VaultPage = lazy(() => import("./pages/Vault/VaultPage"));
const RegistrationPage = lazy(() => import("./pages/Registration/RegistrationPage"));
const PendingApprovalsPage = lazy(() => import("./pages/Users/PendingApprovalsPage"));
const UnusedIPsPage = lazy(() => import("./pages/UnusedIPs/UnusedIPsPage"));
const AssistantPage = lazy(() => import("./pages/Assistant/AssistantPage"));
const FilesPage = lazy(() => import("./pages/Files/FilesPage"));
const SharePage = lazy(() => import("./pages/Share/SharePage"));
const UploadRequestPage = lazy(() => import("./pages/UploadRequest/UploadRequestPage"));
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
      background: "#1e1e28",
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
      components: {
        // antd's dark Menu defaults to its own navy-blue tokens
        // (darkItemBg #001529, darkSubMenuItemBg #000c17) regardless of
        // the Sider's own background — this made the expanded IPAM
        // submenu visibly bluer than the rest of the sidebar. Match the
        // Sider's actual background (#16161f, set in AppLayout.tsx) so
        // the submenu blends in instead of standing out.
        Menu: {
          darkItemBg: "#16161f",
          darkSubMenuItemBg: "#16161f",
        },
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
                background: "#1e1e28",
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
            <Route path="/upload/:token" element={<UploadRequestPage />} />

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

            <Route
              path="/assistant"
              element={
                <ProtectedRoute requiredRole="Viewer">
                  <AppLayout>
                    <AssistantPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/files"
              element={
                <ProtectedRoute requiredRole="Viewer">
                  <FilesLayout>
                    <FilesPage />
                  </FilesLayout>
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

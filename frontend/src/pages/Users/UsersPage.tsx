import React, { useEffect, useState, useCallback } from "react";
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Tooltip,
  Popconfirm,
  message,
  Typography,
  Badge,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import dayjs from "dayjs";
import { usersApi } from "../../api/users";
import { useAuth } from "../../context/AuthContext";
import type { User, UserCreate, UserUpdate } from "../../types/user";
import type { Role } from "../../types/auth";

const ROLE_OPTIONS: Role[] = ["Viewer", "Operator", "Administrator"];

const ROLE_COLOR: Record<Role, string> = {
  Viewer: "default",
  Operator: "blue",
  Administrator: "red",
  SuperAdmin: "purple",
};

const PAGE_SIZE = 20;

type ModalMode = "create" | "edit" | "reset-password" | null;

interface CreateFormValues extends UserCreate {
  confirm_password: string;
}

interface ResetPasswordFormValues {
  new_password: string;
  confirm_password: string;
}

const UsersPage: React.FC = () => {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("SuperAdmin");
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [createForm] = Form.useForm<CreateFormValues>();
  const [editForm] = Form.useForm<UserUpdate>();
  const [resetPwForm] = Form.useForm<ResetPasswordFormValues>();

  const fetchUsers = useCallback(async (page: number): Promise<void> => {
    setLoading(true);
    try {
      const res = await usersApi.list({ page, page_size: PAGE_SIZE });
      setUsers(res.data.items);
      setTotal(res.data.total);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      message.error(
        axiosErr.response?.data?.detail ??
          axiosErr.message ??
          "Failed to load users",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers(currentPage);
  }, [fetchUsers, currentPage]);

  const handleTableChange = useCallback(
    (pagination: TablePaginationConfig): void => {
      setCurrentPage(pagination.current ?? 1);
    },
    [],
  );

  const openCreate = useCallback((): void => {
    setSelectedUser(null);
    createForm.resetFields();
    setModalMode("create");
  }, [createForm]);

  const openEdit = useCallback(
    (user: User): void => {
      setSelectedUser(user);
      editForm.setFieldsValue({
        full_name: user.full_name,
        email: user.email ?? undefined,
        role: user.role,
      });
      setModalMode("edit");
    },
    [editForm],
  );

  const openResetPassword = useCallback(
    (user: User): void => {
      setSelectedUser(user);
      resetPwForm.resetFields();
      setModalMode("reset-password");
    },
    [resetPwForm],
  );

  const handleCreate = useCallback(
    async (values: CreateFormValues): Promise<void> => {
      setSubmitting(true);
      try {
        const payload: UserCreate = {
          username: values.username,
          password: values.password,
          full_name: values.full_name,
          email: values.email || undefined,
          role: values.role,
        };
        await usersApi.create(payload);
        message.success(`User "${payload.username}" created`);
        setModalMode(null);
        createForm.resetFields();
        void fetchUsers(currentPage);
      } catch (err: unknown) {
        const axiosErr = err as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        message.error(
          axiosErr.response?.data?.detail ??
            axiosErr.message ??
            "Failed to create user",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [currentPage, fetchUsers, createForm],
  );

  const handleEdit = useCallback(
    async (values: UserUpdate): Promise<void> => {
      if (!selectedUser) return;
      setSubmitting(true);
      try {
        await usersApi.update(selectedUser.id, {
          ...values,
          email: values.email || undefined,
        });
        message.success("User updated");
        setModalMode(null);
        editForm.resetFields();
        void fetchUsers(currentPage);
      } catch (err: unknown) {
        const axiosErr = err as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        message.error(
          axiosErr.response?.data?.detail ??
            axiosErr.message ??
            "Failed to update user",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [selectedUser, currentPage, fetchUsers, editForm],
  );

  const handleResetPassword = useCallback(
    async (values: ResetPasswordFormValues): Promise<void> => {
      if (!selectedUser) return;
      setSubmitting(true);
      try {
        await usersApi.resetPassword(selectedUser.id, {
          new_password: values.new_password,
        });
        message.success(`Password reset for "${selectedUser.username}"`);
        setModalMode(null);
        resetPwForm.resetFields();
      } catch (err: unknown) {
        const axiosErr = err as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        message.error(
          axiosErr.response?.data?.detail ??
            axiosErr.message ??
            "Failed to reset password",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [selectedUser, resetPwForm],
  );

  const handleToggleActive = useCallback(
    async (user: User): Promise<void> => {
      try {
        if (user.is_active) {
          await usersApi.deactivate(user.id);
          message.success(`User "${user.username}" deactivated`);
        } else {
          await usersApi.activate(user.id);
          message.success(`User "${user.username}" activated`);
        }
        void fetchUsers(currentPage);
      } catch (err: unknown) {
        const axiosErr = err as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        message.error(
          axiosErr.response?.data?.detail ??
            axiosErr.message ??
            "Operation failed",
        );
      }
    },
    [currentPage, fetchUsers],
  );

  const handleDelete = useCallback(
    async (user: User): Promise<void> => {
      try {
        await usersApi.delete(user.id);
        message.success(`User "${user.username}" permanently deleted`);
        void fetchUsers(currentPage);
      } catch (err: unknown) {
        const axiosErr = err as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        message.error(
          axiosErr.response?.data?.detail ??
            axiosErr.message ??
            "Delete failed",
        );
      }
    },
    [currentPage, fetchUsers],
  );

  const columns: ColumnsType<User> = [
    {
      title: "Username",
      dataIndex: "username",
      key: "username",
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: "Full Name",
      dataIndex: "full_name",
      key: "full_name",
    },
    {
      title: "Email",
      dataIndex: "email",
      key: "email",
      render: (v: string | null) =>
        v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: "Role",
      dataIndex: "role",
      key: "role",
      width: 130,
      render: (v: Role) => <Tag color={ROLE_COLOR[v]}>{v}</Tag>,
    },
    {
      title: "Status",
      dataIndex: "is_active",
      key: "is_active",
      width: 100,
      render: (v: boolean) =>
        v ? (
          <Badge status="success" text="Active" />
        ) : (
          <Badge status="error" text="Inactive" />
        ),
    },
    {
      title: "Last Login",
      dataIndex: "last_login",
      key: "last_login",
      width: 170,
      render: (v: string | null) =>
        v ? (
          dayjs(v).format("YYYY-MM-DD HH:mm")
        ) : (
          <Typography.Text type="secondary">Never</Typography.Text>
        ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 160,
      render: (_, record) => (
        <Space size={4}>
          {isSuperAdmin && (
            <Tooltip title="Edit">
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEdit(record)}
              />
            </Tooltip>
          )}
          {isSuperAdmin && (
            <Tooltip title="Reset Password">
              <Button
                size="small"
                icon={<KeyOutlined />}
                onClick={() => openResetPassword(record)}
              />
            </Tooltip>
          )}
          {isSuperAdmin && (
            <Popconfirm
              title={
                record.is_active
                  ? "Deactivate this user?"
                  : "Activate this user?"
              }
              onConfirm={() => void handleToggleActive(record)}
              okText="Confirm"
            >
              <Tooltip title={record.is_active ? "Deactivate" : "Activate"}>
                <Button
                  size="small"
                  icon={
                    record.is_active ? (
                      <StopOutlined />
                    ) : (
                      <CheckCircleOutlined />
                    )
                  }
                  danger={record.is_active}
                  type={record.is_active ? undefined : "primary"}
                />
              </Tooltip>
            </Popconfirm>
          )}
          {isSuperAdmin && (
            <Popconfirm
              title={`Permanently delete "${record.username}"?`}
              description="This cannot be undone. Audit logs for this user are kept."
              onConfirm={() => void handleDelete(record)}
              okText="Delete"
              okButtonProps={{ danger: true }}
            >
              <Tooltip title="Delete permanently">
                <Button size="small" icon={<DeleteOutlined />} danger />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          User Management
        </Typography.Title>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void fetchUsers(currentPage)}
            loading={loading}
          >
            Refresh
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Create User
          </Button>
        </Space>
      </div>

      <Table<User>
        dataSource={users}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: currentPage,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (t) => `${t} users`,
        }}
        onChange={handleTableChange}
        size="small"
      />

      {/* Create User Modal */}
      <Modal
        title="Create User"
        open={modalMode === "create"}
        onCancel={() => {
          setModalMode(null);
          createForm.resetFields();
        }}
        onOk={() => createForm.submit()}
        okText="Create"
        confirmLoading={submitting}
        width={480}
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={(values) => void handleCreate(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="Username"
            name="username"
            rules={[
              { required: true, message: "Username is required" },
              { min: 3, message: "At least 3 characters" },
              {
                pattern: /^[a-zA-Z0-9._-]+$/,
                message: "Only letters, digits, dots, underscores, hyphens",
              },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="Full Name"
            name="full_name"
            rules={[{ required: true, message: "Full name is required" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="Email"
            name="email"
            rules={[{ type: "email", message: "Enter a valid email" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="Role"
            name="role"
            rules={[{ required: true, message: "Role is required" }]}
          >
            <Select>
              {ROLE_OPTIONS.map((r) => (
                <Select.Option key={r} value={r}>
                  <Tag color={ROLE_COLOR[r]}>{r}</Tag>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="Password"
            name="password"
            rules={[
              { required: true, message: "Password is required" },
              { min: 8, message: "At least 8 characters" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="Confirm Password"
            name="confirm_password"
            dependencies={["password"]}
            rules={[
              { required: true, message: "Please confirm password" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("password") === value) {
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

      {/* Edit User Modal */}
      <Modal
        title={`Edit User: ${selectedUser?.username ?? ""}`}
        open={modalMode === "edit"}
        onCancel={() => {
          setModalMode(null);
          editForm.resetFields();
        }}
        onOk={() => editForm.submit()}
        okText="Save"
        confirmLoading={submitting}
        width={420}
        destroyOnClose
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => void handleEdit(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="Full Name"
            name="full_name"
            rules={[{ required: true, message: "Full name is required" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="Email"
            name="email"
            rules={[{ type: "email", message: "Enter a valid email" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="Role" name="role">
            <Select>
              {ROLE_OPTIONS.map((r) => (
                <Select.Option key={r} value={r}>
                  <Tag color={ROLE_COLOR[r]}>{r}</Tag>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        title={`Reset Password: ${selectedUser?.username ?? ""}`}
        open={modalMode === "reset-password"}
        onCancel={() => {
          setModalMode(null);
          resetPwForm.resetFields();
        }}
        onOk={() => resetPwForm.submit()}
        okText="Reset Password"
        okButtonProps={{ danger: true }}
        confirmLoading={submitting}
        width={400}
        destroyOnClose
      >
        <Form
          form={resetPwForm}
          layout="vertical"
          onFinish={(values) => void handleResetPassword(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="New Password"
            name="new_password"
            rules={[
              { required: true, message: "Password is required" },
              { min: 8, message: "At least 8 characters" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="Confirm Password"
            name="confirm_password"
            dependencies={["new_password"]}
            rules={[
              { required: true, message: "Please confirm password" },
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

export default UsersPage;

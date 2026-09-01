import React, { useEffect, useState, useCallback } from "react";
import {
  Modal,
  Tabs,
  Table,
  Typography,
  Tag,
  Spin,
  Alert,
  Empty,
  Button,
  Space,
} from "antd";
import { ScanOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ipRecordsApi } from "../../api/ipRecords";
import type {
  DuplicateGroup,
  DuplicateRecordRef,
  DuplicatesResult,
} from "../../api/ipRecords";
import BulkCheckAvailabilityModal from "./BulkCheckAvailabilityModal";

interface DuplicatesModalProps {
  open: boolean;
  onClose: () => void;
}

const recordColumns: ColumnsType<DuplicateRecordRef> = [
  {
    title: "IP Address",
    dataIndex: "ip_address",
    key: "ip_address",
    render: (v: string) => (
      <Typography.Text code style={{ fontSize: 12 }}>
        {v}
      </Typography.Text>
    ),
  },
  {
    title: "Hostname",
    dataIndex: "hostname",
    key: "hostname",
    render: (v: string | null) => v ?? "—",
  },
  {
    title: "Status",
    dataIndex: "status",
    key: "status",
    render: (v: string) => <Tag>{v}</Tag>,
  },
];

/** All distinct record IDs across every duplicate group in a list — used
 * to feed "Bulk Scan" the full affected set, not just what's displayed. */
function flattenIds(groups: DuplicateGroup[]): string[] {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const record of group.records) {
      ids.add(record.id);
    }
  }
  return Array.from(ids);
}

const DuplicatesModal: React.FC<DuplicatesModalProps> = ({ open, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DuplicatesResult | null>(null);
  const [bulkScanIds, setBulkScanIds] = useState<string[] | null>(null);

  const fetchDuplicates = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await ipRecordsApi.getDuplicates();
      setData(res.data);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      setError(
        axiosErr.response?.data?.detail ??
          axiosErr.message ??
          "Failed to load duplicates",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void fetchDuplicates();
  }, [open, fetchDuplicates]);

  const groupColumns = (
    label: string,
  ): ColumnsType<DuplicateGroup> => [
    {
      title: label,
      dataIndex: "value",
      key: "value",
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: "Count",
      dataIndex: "count",
      key: "count",
      width: 90,
      render: (v: number) => <Tag color="orange">{v}</Tag>,
    },
  ];

  const renderGroups = (
    groups: DuplicateGroup[],
    label: string,
    emptyText: string,
  ): React.ReactNode => {
    if (groups.length === 0) {
      return <Empty description={emptyText} />;
    }
    const ids = flattenIds(groups);
    return (
      <>
        <Space style={{ marginBottom: 8 }}>
          <Button
            size="small"
            icon={<ScanOutlined />}
            onClick={() => setBulkScanIds(ids)}
          >
            Bulk Scan All ({ids.length} records)
          </Button>
        </Space>
        <Table<DuplicateGroup>
          dataSource={groups}
          rowKey="value"
          size="small"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={groupColumns(label)}
          expandable={{
            expandedRowRender: (group) => (
              <Table<DuplicateRecordRef>
                dataSource={group.records}
                rowKey="id"
                size="small"
                pagination={false}
                columns={recordColumns}
              />
            ),
          }}
        />
      </>
    );
  };

  return (
    <>
      <Modal
        title="Duplicate IP Records"
        open={open}
        onCancel={onClose}
        footer={null}
        width={720}
      >
        {loading && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin />
          </div>
        )}

        {error && <Alert type="error" showIcon message={error} />}

        {!loading && !error && data && (
          <Tabs
            items={[
              {
                key: "hostnames",
                label: `Duplicate Hostnames (${data.duplicate_hostnames.length})`,
                children: renderGroups(
                  data.duplicate_hostnames,
                  "Hostname",
                  "No duplicate hostnames found.",
                ),
              },
              {
                key: "ips",
                label: `Duplicate IP Addresses (${data.duplicate_ips.length})`,
                children: renderGroups(
                  data.duplicate_ips,
                  "IP Address",
                  "No duplicate IP addresses found — expected, since IPs are enforced unique.",
                ),
              },
            ]}
          />
        )}
      </Modal>

      <BulkCheckAvailabilityModal
        open={!!bulkScanIds}
        onClose={() => setBulkScanIds(null)}
        ids={bulkScanIds ?? []}
        onUpdated={() => void fetchDuplicates()}
      />
    </>
  );
};

export default DuplicatesModal;

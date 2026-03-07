import React, { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Typography,
  Row,
  Col,
  Button,
  Space,
  Tag,
  message,
} from 'antd';
import { CloudServerOutlined, BugOutlined } from '@ant-design/icons';
import { subnetsApi } from '../../api/subnets';
import type { SubnetDetail } from '../../types/subnet';
import VSphereImportDrawer from './VSphereImportDrawer';

const IntegrationsPage: React.FC = () => {
  const [subnets, setSubnets] = useState<SubnetDetail[]>([]);
  const [vsphereOpen, setVsphereOpen] = useState(false);

  const fetchSubnets = useCallback(async (): Promise<void> => {
    try {
      const res = await subnetsApi.list({ page_size: 1000 });
      setSubnets(res.data.items);
    } catch {
      message.error('Failed to load subnets');
    }
  }, []);

  useEffect(() => {
    void fetchSubnets();
  }, [fetchSubnets]);

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 24 }}>
        Integrations
      </Typography.Title>

      <Row gutter={[16, 16]}>
        {/* vSphere Import */}
        <Col xs={24} sm={12} lg={8}>
          <Card
            hoverable
            title={
              <Space>
                <CloudServerOutlined style={{ color: '#1677ff', fontSize: 20 }} />
                <span>VMware vSphere</span>
              </Space>
            }
            extra={<Tag color="blue">VM Import</Tag>}
          >
            <Typography.Paragraph type="secondary" style={{ minHeight: 60 }}>
              Connect to vCenter and discover virtual machines. Select VMs to
              bulk-import their IP addresses as IPAM records.
            </Typography.Paragraph>
            <Button
              type="primary"
              icon={<CloudServerOutlined />}
              onClick={() => setVsphereOpen(true)}
            >
              Open vSphere Import
            </Button>
          </Card>
        </Col>

        {/* DNS Scan (info card — functionality is per-subnet in Subnets page) */}
        <Col xs={24} sm={12} lg={8}>
          <Card
            title={
              <Space>
                <BugOutlined style={{ color: '#52c41a', fontSize: 20 }} />
                <span>DNS Conflict Detection</span>
              </Space>
            }
            extra={<Tag color="green">Per-Subnet</Tag>}
          >
            <Typography.Paragraph type="secondary" style={{ minHeight: 60 }}>
              Detect forward/PTR mismatches and duplicate hostnames. Available
              per-subnet via the{' '}
              <Typography.Text strong>Scan Conflicts</Typography.Text> button in
              the Subnets page.
            </Typography.Paragraph>
            <Button
              href="/subnets"
              icon={<BugOutlined />}
            >
              Go to Subnets
            </Button>
          </Card>
        </Col>
      </Row>

      <VSphereImportDrawer
        open={vsphereOpen}
        subnets={subnets}
        onClose={() => {
          setVsphereOpen(false);
          void fetchSubnets();
        }}
      />
    </div>
  );
};

export default IntegrationsPage;

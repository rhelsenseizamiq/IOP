import React, { useEffect } from 'react';
import { Modal, Form, Input, Select, InputNumber, Row, Col, message, Tag } from 'antd';
import { subnetsApi } from '../../api/subnets';
import type { SubnetDetail } from '../../types/subnet';
import type { Environment } from '../../types/ipRecord';
import { ENV_OPTIONS, ENV_COLOR } from '../../constants/environments';

interface Props {
  open: boolean;
  suggestedCidr: string;
  onCreated: (subnet: SubnetDetail) => void;
  onCancel: () => void;
}

interface FormValues {
  cidr: string;
  name: string;
  environment: Environment;
  gateway?: string;
  vlan_id?: number;
  description?: string;
}

const CreateSubnetModal: React.FC<Props> = ({ open, suggestedCidr, onCreated, onCancel }) => {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = React.useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ cidr: suggestedCidr });
    }
  }, [open, suggestedCidr, form]);

  const handleOk = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const res = await subnetsApi.create({
        cidr: values.cidr,
        name: values.name,
        environment: values.environment,
        gateway: values.gateway || undefined,
        vlan_id: values.vlan_id || undefined,
        description: values.description || undefined,
      });
      // Fetch the full detail (with utilization fields)
      const detail = await subnetsApi.get(res.data.id);
      message.success(`Subnet ${values.cidr} created`);
      onCreated(detail.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      message.error(axiosErr.response?.data?.detail ?? axiosErr.message ?? 'Failed to create subnet');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Create Subnet"
      open={open}
      onOk={() => void handleOk()}
      onCancel={onCancel}
      okText="Create & Assign"
      confirmLoading={submitting}
      width={480}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          label="CIDR"
          name="cidr"
          rules={[
            { required: true, message: 'CIDR is required' },
            {
              pattern: /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
              message: 'Enter a valid CIDR (e.g. 192.168.1.0/24)',
            },
          ]}
        >
          <Input placeholder="192.168.1.0/24" />
        </Form.Item>

        <Form.Item
          label="Name"
          name="name"
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. Office LAN" />
        </Form.Item>

        <Form.Item
          label="Environment"
          name="environment"
          rules={[{ required: true, message: 'Environment is required' }]}
        >
          <Select>
            {ENV_OPTIONS.map((e) => (
              <Select.Option key={e} value={e}>
                <Tag color={ENV_COLOR[e]}>{e}</Tag>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Gateway" name="gateway">
              <Input placeholder="192.168.1.1" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="VLAN ID" name="vlan_id">
              <InputNumber min={1} max={4094} style={{ width: '100%' }} placeholder="100" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="Description" name="description">
          <Input.TextArea rows={2} placeholder="Optional description" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateSubnetModal;

import React, { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  List,
  Popconfirm,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, FolderOpenOutlined, PlusOutlined } from '@ant-design/icons';
import { cabinetsApi } from '../../api/vault';
import type { Cabinet } from '../../types/vault';
import CabinetModal from './CabinetModal';

interface Props {
  selectedId: string | null;
  onSelect: (id: string, name: string) => void;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  currentUsername: string | null;
}

const CabinetList: React.FC<Props> = ({ selectedId, onSelect, isAdmin, isSuperAdmin, currentUsername }) => {
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editCabinet, setEditCabinet] = useState<Cabinet | null>(null);

  const fetchCabinets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cabinetsApi.list();
      setCabinets(res.data);
    } catch {
      message.error('Failed to load cabinets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCabinets();
  }, [fetchCabinets]);

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await cabinetsApi.delete(id);
      message.success('Cabinet deleted');
      fetchCabinets();
    } catch {
      message.error('Failed to delete cabinet');
    }
  };

  const openCreate = (): void => {
    setEditCabinet(null);
    setModalOpen(true);
  };

  const openEdit = (cabinet: Cabinet, e: React.MouseEvent): void => {
    e.stopPropagation();
    setEditCabinet(cabinet);
    setModalOpen(true);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Typography.Text strong>Cabinets</Typography.Text>
        {isAdmin && (
          <Tooltip title="New Cabinet">
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate} />
          </Tooltip>
        )}
      </div>

      <List
        loading={loading}
        dataSource={cabinets}
        style={{ flex: 1, overflowY: 'auto' }}
        renderItem={(cabinet) => (
          <List.Item
            onClick={() => onSelect(cabinet.id, cabinet.name)}
            style={{
              cursor: 'pointer',
              padding: '10px 16px',
              backgroundColor: selectedId === cabinet.id ? '#e6f4ff' : undefined,
              borderLeft: selectedId === cabinet.id ? '3px solid #1677ff' : '3px solid transparent',
            }}
            actions={
              isAdmin
                ? [
                    <Tooltip title="Edit" key="edit">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={(e) => openEdit(cabinet, e)}
                      />
                    </Tooltip>,
                    ...(isSuperAdmin
                      ? [
                          <Popconfirm
                            key="delete"
                            title={`Delete cabinet "${cabinet.name}" and all its entries?`}
                            onConfirm={() => handleDelete(cabinet.id)}
                            okText="Delete"
                            okButtonProps={{ danger: true }}
                          >
                            <Tooltip title="Delete">
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </Tooltip>
                          </Popconfirm>,
                        ]
                      : []),
                  ]
                : []
            }
          >
            <Space>
              <FolderOpenOutlined style={{ color: '#faad14' }} />
              <Typography.Text>{cabinet.name}</Typography.Text>
              <Badge count={cabinet.entry_count} showZero color="#1677ff" size="small" />
            </Space>
          </List.Item>
        )}
      />

      <CabinetModal
        open={modalOpen}
        cabinet={editCabinet}
        isSuperAdmin={isSuperAdmin}
        currentUsername={currentUsername}
        onClose={() => setModalOpen(false)}
        onSaved={fetchCabinets}
      />
    </div>
  );
};

export default CabinetList;

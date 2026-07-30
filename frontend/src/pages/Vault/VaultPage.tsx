import React, { useState } from 'react';
import { Card, Col, Row, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext';
import CabinetList from './CabinetList';
import FolderTree, { type FolderSelection } from './FolderTree';
import PasswordTable from './PasswordTable';

const VaultPage: React.FC = () => {
  const { hasRole, username } = useAuth();
  const [selectedCabinetId, setSelectedCabinetId] = useState<string | null>(null);
  const [selectedCabinetName, setSelectedCabinetName] = useState<string>('');
  const [folderSelection, setFolderSelection] = useState<FolderSelection>({ type: 'all' });
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [dropVersion, setDropVersion] = useState(0);

  const isSuperAdmin = hasRole('SuperAdmin');
  const isAdmin = hasRole('Administrator');
  const canEdit = hasRole('Operator');

  const handleSelectCabinet = (id: string, name: string) => {
    setSelectedCabinetId(id);
    setSelectedCabinetName(name);
    setFolderSelection({ type: 'all' });
  };

  const handleBack = () => {
    setSelectedCabinetId(null);
    setSelectedCabinetName('');
    setFolderSelection({ type: 'all' });
  };

  const handleDropToFolder = async (entryId: string, folderId: string | null) => {
    const { passwordsApi } = await import('../../api/vault');
    try {
      await passwordsApi.move(entryId, folderId);
      setDropVersion((v) => v + 1);
    } catch {
      const { message } = await import('antd');
      message.error('Failed to move entry');
    }
    setDraggingEntryId(null);
  };

  const activeFolderId =
    folderSelection.type === 'folder' ? folderSelection.folderId : undefined;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <LockOutlined style={{ marginRight: 8 }} />
          Password Vault
        </Typography.Title>
        <Typography.Text type="secondary">
          Shared team credentials — visible only to cabinet members
        </Typography.Text>
      </div>

      <Row gutter={16} style={{ height: 'calc(100vh - 200px)' }}>
        {/* Left: Cabinets or Folder Tree */}
        <Col flex="300px">
          <Card
            bodyStyle={{ padding: 0, height: '100%' }}
            style={{ height: '100%', overflow: 'hidden' }}
          >
            {selectedCabinetId ? (
              <FolderTree
                cabinetId={selectedCabinetId}
                cabinetName={selectedCabinetName}
                selection={folderSelection}
                onSelect={setFolderSelection}
                onBack={handleBack}
                canEdit={canEdit}
                draggingEntryId={draggingEntryId}
                onDropToFolder={handleDropToFolder}
              />
            ) : (
              <CabinetList
                selectedId={null}
                onSelect={handleSelectCabinet}
                isAdmin={isAdmin || isSuperAdmin}
                isSuperAdmin={isSuperAdmin}
                currentUsername={username}
              />
            )}
          </Card>
        </Col>

        {/* Right: Password Table */}
        <Col flex="1">
          <Card
            style={{ height: '100%', overflow: 'auto' }}
            bodyStyle={{ padding: 16 }}
          >
            {selectedCabinetId ? (
              <PasswordTable
                cabinetId={selectedCabinetId}
                folderId={activeFolderId ?? null}
                showAllFolders={folderSelection.type === 'all'}
                canEdit={canEdit}
                onDragStart={setDraggingEntryId}
                onDragEnd={() => setDraggingEntryId(null)}
                refreshVersion={dropVersion}
              />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#bfbfbf',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <LockOutlined style={{ fontSize: 48, marginBottom: 12 }} />
                  <Typography.Title level={5} type="secondary">
                    Select a cabinet to view entries
                  </Typography.Title>
                </div>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default VaultPage;

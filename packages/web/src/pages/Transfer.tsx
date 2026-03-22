// Transfer Page - 2분할 파일 전송 + 백업 (v2)

import { useState, useEffect, useRef, useCallback } from 'react';
import { useMachineStore, useDncConfig } from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { useFileStore } from '../stores/fileStore';
import { backupApi, fileApi } from '../lib/api';
import { wsClient } from '../lib/wsClient';
import { FileListPanel } from '../components/filemanager/FileListPanel';
import { TransferArrows } from '../components/filemanager/TransferArrows';
import { TransferQueuePanel } from '../components/filemanager/TransferQueuePanel';
import { GCodeViewer } from '../components/filemanager/GCodeViewer';
import { MOCK_GCODE_CONTENT } from '../components/filemanager/mockFileData';
import { MachineTopBar } from '../components/MachineTopBar';
import type { FileEntry, TransferDirection } from '../stores/fileStore';

type TransferTab = 'transfer' | 'backup';

interface BackupRecord {
  id: string;
  machineId: string;
  type: 'SRAM' | 'PARAMETER' | 'PROGRAM' | 'FULL';
  fileName: string;
  fileSize: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  createdBy: string;
}

export function Transfer() {
  const user = useAuthStore((state) => state.user);
  const { selectedMachineId } = useMachineStore();
  const canTransfer = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';

  const [activeTab, setActiveTab] = useState<TransferTab>('transfer');

  const machineId = selectedMachineId || '';

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-64px)]">
      {/* MachineTopBar */}
      <div className="flex-shrink-0">
        <MachineTopBar pageTitle="프로그램 전송" pageId={activeTab === 'transfer' ? 'transfer' : 'backup'} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 mb-4 flex-shrink-0">
        <button
          onClick={() => setActiveTab('transfer')}
          className={`flex items-center gap-2 px-4 py-3 font-medium border-b-2 transition-colors ${
            activeTab === 'transfer'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <TransferIcon className="w-5 h-5" />
          파일 전송
        </button>
        <button
          onClick={() => setActiveTab('backup')}
          className={`flex items-center gap-2 px-4 py-3 font-medium border-b-2 transition-colors ${
            activeTab === 'backup'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <BackupIcon className="w-5 h-5" />
          백업
        </button>
      </div>

      {machineId && (
        <>
          {activeTab === 'transfer' && (
            <TransferSection machineId={machineId} canTransfer={canTransfer} />
          )}
          {activeTab === 'backup' && (
            <BackupSection machineId={machineId} canTransfer={canTransfer} />
          )}
        </>
      )}

      {!canTransfer && (
        <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-800 rounded-lg flex-shrink-0">
          <p className="text-sm text-yellow-400">
            프로그램 전송 권한이 없습니다. 관리자 또는 HQ 엔지니어에게 문의하세요.
          </p>
        </div>
      )}

      {/* G-Code 뷰어 모달 */}
      <GCodeViewer />
    </div>
  );
}

// ============================================================
// 전송 확인 다이얼로그
// ============================================================
interface ConfirmDialogProps {
  direction: TransferDirection;
  fileNames: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

function TransferConfirmDialog({ direction, fileNames, onConfirm, onCancel }: ConfirmDialogProps) {
  const dirLabel = direction === 'PC_TO_CNC' ? 'PC → CNC' : 'CNC → PC';
  const dirColor = direction === 'PC_TO_CNC' ? 'text-blue-400' : 'text-green-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-xl w-96 max-h-[80vh] flex flex-col border border-gray-600">
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">전송 확인</h3>
        </div>

        {/* 본문 */}
        <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto">
          <div className="mb-4">
            <span className="text-sm text-gray-400">전송 방향: </span>
            <span className={`text-sm font-semibold ${dirColor}`}>{dirLabel}</span>
          </div>
          <div className="text-sm text-gray-400 mb-2">
            선택된 파일 ({fileNames.length}개):
          </div>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {fileNames.map((name) => (
              <li key={name} className="flex items-center gap-2 text-sm text-white font-mono bg-gray-900 px-3 py-1.5 rounded">
                <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {name}
              </li>
            ))}
          </ul>
        </div>

        {/* 하단 버튼 */}
        <div className="px-5 py-3 border-t border-gray-700 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            전송 실행
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 파일 전송 섹션 (2분할: 좌측=CNC, 우측=PC)
// ============================================================
function TransferSection({ machineId, canTransfer }: { machineId: string; canTransfer: boolean }) {
  const user = useAuthStore((state) => state.user);
  const {
    shareFiles,
    cncFiles,
    shareLoading,
    cncLoading,
    cncError,
    selectedShareFiles,
    selectedCncFiles,
    loadShareFiles,
    loadCncFiles,
    setSelectedShareFiles,
    setSelectedCncFiles,
    startTransfer,
    uploadToShare,
    deleteFromShare,
    openViewer,
  } = useFileStore();

  const dncConfig = useDncConfig(machineId);
  const pathCount = dncConfig?.pathCount || 2;

  const [cncPath, setCncPath] = useState<'path1' | 'path2' | 'path3'>('path1');

  // Confirm 다이얼로그 상태
  const [confirmDialog, setConfirmDialog] = useState<{
    direction: TransferDirection;
    fileNames: string[];
  } | null>(null);

  // CNC Path 경로 텍스트
  const cncPathComment = dncConfig?.dncPaths?.[cncPath]
    ? `${dncConfig.dncPaths[cncPath]}`
    : `//CNC/${machineId}/${cncPath.toUpperCase()}`;

  const pcPathComment = '//SERVER/share/programs';

  // 초기 로드
  useEffect(() => {
    loadShareFiles();
  }, [loadShareFiles]);

  useEffect(() => {
    if (machineId) loadCncFiles(machineId, cncPath);
  }, [machineId, cncPath, loadCncFiles]);

  // Path 전환 시 선택 초기화
  useEffect(() => {
    setSelectedCncFiles([]);
  }, [cncPath, setSelectedCncFiles]);

  // → (오른쪽): CNC → PC — 확인 다이얼로그 표시
  const handleTransferRight = useCallback(() => {
    if (selectedCncFiles.length === 0) return;
    setConfirmDialog({ direction: 'CNC_TO_PC', fileNames: selectedCncFiles });
  }, [selectedCncFiles]);

  // ← (왼쪽): PC → CNC — 확인 다이얼로그 표시
  const handleTransferLeft = useCallback(() => {
    if (selectedShareFiles.length === 0) return;
    setConfirmDialog({ direction: 'PC_TO_CNC', fileNames: selectedShareFiles });
  }, [selectedShareFiles]);

  // 확인 다이얼로그에서 전송 실행
  const handleConfirmTransfer = useCallback(() => {
    if (!confirmDialog) return;
    const userName = user?.username || 'unknown';
    startTransfer(confirmDialog.direction, confirmDialog.fileNames, machineId, userName);
    setConfirmDialog(null);
  }, [confirmDialog, machineId, startTransfer, user]);

  const handleShareUpload = useCallback(async (file: File) => {
    try {
      const res = await fileApi.uploadShareFile(file);
      if (res.success && res.data) {
        const d = res.data as { name: string; size: number; modifiedAt: string };
        uploadToShare(d.name, d.size);
      } else {
        console.error('Upload failed:', res.error?.message);
      }
    } catch (err) {
      console.error('Upload error:', err);
    }
    void loadShareFiles();
  }, [uploadToShare, loadShareFiles]);

  const handleShareDelete = useCallback((fileNames: string[]) => {
    if (!confirm(`${fileNames.length}개 파일을 삭제하시겠습니까?`)) return;
    deleteFromShare(fileNames);
  }, [deleteFromShare]);

  const handleShareDoubleClick = useCallback((file: FileEntry) => {
    const content = MOCK_GCODE_CONTENT[file.name] || '';
    openViewer(file.name, content, false, 'TRANSFER_SHARE', machineId);
  }, [openViewer, machineId]);

  const handleCncDoubleClick = useCallback((file: FileEntry) => {
    const content = MOCK_GCODE_CONTENT[file.name] || '';
    openViewer(file.name, content, true, 'CNC_LOCAL', machineId);
  }, [openViewer, machineId]);

  const pathTabs: { key: 'path1' | 'path2' | 'path3'; label: string }[] = [
    { key: 'path1', label: 'PATH1' },
    { key: 'path2', label: 'PATH2' },
  ];
  if (pathCount >= 3) {
    pathTabs.push({ key: 'path3', label: 'PATH3' });
  }

  // Path 선택 탭 (headerSlot으로 FileListPanel 헤더에 삽입)
  const cncPathSlot = (
    <div className="flex items-center gap-1">
      {pathTabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setCncPath(tab.key)}
          className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
            cncPath === tab.key
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 2분할 패널: 좌 4.5 : 우 5.5 */}
      <div className="flex-1 grid grid-cols-[4.5fr_auto_5.5fr] gap-0 min-h-0">
        {/* 좌측: CNC 프로그램 */}
        <FileListPanel
          title={`CNC (${machineId})`}
          files={cncFiles}
          isLoading={cncLoading}
          selectable={canTransfer}
          selectedFiles={selectedCncFiles}
          onSelectFiles={setSelectedCncFiles}
          onRefresh={() => loadCncFiles(machineId, cncPath)}
          onDoubleClick={handleCncDoubleClick}
          pathComment={cncPathComment}
          headerSlot={cncPathSlot}
          lockMessage={cncError ?? undefined}
          emptyMessage="새로고침(↺) 버튼을 눌러 재시도하거나 Agent 상태를 확인하세요"
          readOnly
          showComment
        />

        {/* 중앙: 전송 화살표 */}
        <TransferArrows
          canTransferRight={selectedCncFiles.length > 0}
          canTransferLeft={selectedShareFiles.length > 0}
          onTransferRight={handleTransferRight}
          onTransferLeft={handleTransferLeft}
          disabled={!canTransfer}
        />

        {/* 우측: PC 공용 저장소 */}
        <FileListPanel
          title="PC 공용 저장소"
          files={shareFiles}
          isLoading={shareLoading}
          selectable={canTransfer}
          selectedFiles={selectedShareFiles}
          onSelectFiles={setSelectedShareFiles}
          onRefresh={loadShareFiles}
          onDoubleClick={handleShareDoubleClick}
          onDelete={canTransfer ? handleShareDelete : undefined}
          onUpload={canTransfer ? handleShareUpload : undefined}
          pathComment={pcPathComment}
        />
      </div>

      {/* 전송 큐 - 항상 고정 영역 */}
      <TransferQueuePanel />

      {/* 전송 확인 다이얼로그 */}
      {confirmDialog && (
        <TransferConfirmDialog
          direction={confirmDialog.direction}
          fileNames={confirmDialog.fileNames}
          onConfirm={handleConfirmTransfer}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// 백업 섹션 (기존 로직 유지)
// ============================================================
function BackupSection({ machineId, canTransfer }: { machineId: string; canTransfer: boolean }) {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupType, setBackupType] = useState<'SRAM' | 'PARAMETER' | 'PROGRAM' | 'FULL'>('FULL');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadBackups = useCallback(async () => {
    if (!machineId) return;
    setIsLoading(true);
    try {
      const response = await backupApi.getHistory(machineId);
      if (response.success && response.data) {
        const d = response.data as { items?: BackupRecord[] } | BackupRecord[];
        setBackups(Array.isArray(d) ? d : (d as { items?: BackupRecord[] }).items ?? []);
      }
    } catch (err) {
      console.error('Failed to load backups:', err);
    } finally {
      setIsLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  // WS: backup_completed 이벤트 수신 시 이력 갱신
  const loadBackupsRef = useRef(loadBackups);
  loadBackupsRef.current = loadBackups;
  useEffect(() => {
    return wsClient.onMessage((msg) => {
      if (msg.type === 'backup_completed') {
        void loadBackupsRef.current();
      }
    });
  }, []);

  const handleBackup = async () => {
    if (!machineId) return;
    setError(null);
    setSuccess(null);
    setIsLoading(true);
    try {
      const response = await backupApi.create(machineId, backupType);
      if (response.success) {
        setSuccess('백업 시작됨');
        loadBackups();
      } else {
        setError(response.error?.message || '백업 실패');
      }
    } catch {
      setError('서버 연결 오류');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackupDownload = async (backupId: string, fileName: string) => {
    try {
      const response = await backupApi.download(backupId);
      if (response.success && response.data) {
        const blob = new Blob([response.data as ArrayBuffer]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setError('백업 다운로드 실패');
    }
  };

  return (
    <div className="space-y-6">
      {/* Messages */}
      {error && (
        <div className="p-3 bg-red-900/30 text-red-400 rounded-lg">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-green-900/30 text-green-400 rounded-lg">{success}</div>
      )}

      {/* Create Backup */}
      <div className="bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          새 백업 생성
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              백업 유형
            </label>
            <select
              value={backupType}
              onChange={(e) => setBackupType(e.target.value as typeof backupType)}
              className="px-3 py-2 border border-gray-600 rounded-lg bg-gray-700 text-white"
            >
              <option value="FULL">전체 백업</option>
              <option value="SRAM">SRAM</option>
              <option value="PARAMETER">파라미터</option>
              <option value="PROGRAM">프로그램</option>
            </select>
          </div>
          <button
            onClick={handleBackup}
            disabled={!canTransfer || isLoading}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            {isLoading ? '백업 중...' : '백업 시작'}
          </button>
        </div>
      </div>

      {/* Backup History */}
      <div className="bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          백업 이력
        </h2>
        <table className="w-full">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">유형</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">파일명</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">크기</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">생성일</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">생성자</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-600">
            {backups.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  백업 이력이 없습니다
                </td>
              </tr>
            ) : (
              backups.map((backup) => (
                <tr key={backup.id} className="hover:bg-gray-700">
                  <td className="px-4 py-2">
                    <BackupTypeBadge type={backup.type} />
                  </td>
                  <td className="px-4 py-2 font-mono text-sm text-white">
                    {backup.fileName}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-400">
                    {backup.status === 'COMPLETED' ? formatFileSize(backup.fileSize) : (
                      <span className={`text-xs ${backup.status === 'FAILED' ? 'text-red-400' : 'text-yellow-400'}`}>
                        {backup.status === 'FAILED' ? '실패' : '처리 중...'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-400">
                    {new Date(backup.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-400">
                    {backup.createdBy}
                  </td>
                  <td className="px-4 py-2">
                    {backup.status === 'COMPLETED' ? (
                      <button
                        onClick={() => handleBackupDownload(backup.id, backup.fileName)}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        다운로드
                      </button>
                    ) : (
                      <span className="text-gray-600 text-sm">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Helper ──
function BackupTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    FULL: 'bg-purple-900/30 text-purple-400',
    SRAM: 'bg-blue-900/30 text-blue-400',
    PARAMETER: 'bg-green-900/30 text-green-400',
    PROGRAM: 'bg-orange-900/30 text-orange-400',
  };
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${styles[type] || styles.FULL}`}>
      {type}
    </span>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Icons ──
function TransferIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  );
}

function BackupIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
    </svg>
  );
}

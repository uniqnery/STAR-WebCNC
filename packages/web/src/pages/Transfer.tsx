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
    <div className="p-6 lg:p-4 flex flex-col lg:h-full lg:overflow-hidden max-lg:portrait:h-auto max-lg:portrait:min-h-[100dvh] max-lg:portrait:p-3">
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
  cncPath?: 'path1' | 'path2' | 'path3';
  onConfirm: () => void;
  onCancel: () => void;
}

function TransferConfirmDialog({ direction, fileNames, cncPath, onConfirm, onCancel }: ConfirmDialogProps) {
  const dirLabel = direction === 'PC_TO_CNC' ? 'PC → CNC' : 'CNC → PC';
  const dirColor = direction === 'PC_TO_CNC' ? 'text-blue-400' : 'text-green-400';

  const displayName = (name: string) => {
    if (direction !== 'CNC_TO_PC') return name;
    if (cncPath === 'path2') return `${name}.P-2`;
    if (cncPath === 'path3') return `${name}.P-3`;
    return `${name}.nc`;
  };

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
                {displayName(name)}
              </li>
            ))}
          </ul>
        </div>

        {/* 하단 버튼 */}
        <div className="px-5 py-3 border-t border-gray-700 flex items-center justify-end gap-3">
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            전송 실행
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 범용 확인 다이얼로그 (다운로드 / 삭제 등)
// ============================================================
interface SimpleConfirmDialogProps {
  title: string;
  description: string;
  fileNames: string[];
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function SimpleConfirmDialog({ title, description, fileNames, confirmLabel, confirmColor, onConfirm, onCancel }: SimpleConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-xl w-96 max-h-[80vh] flex flex-col border border-gray-600">
        <div className="px-5 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
        </div>
        <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto">
          <p className="text-sm text-gray-400 mb-3">{description}</p>
          <div className="text-sm text-gray-400 mb-2">선택된 파일 ({fileNames.length}개):</div>
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
        <div className="px-5 py-3 border-t border-gray-700 flex items-center justify-end gap-3">
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm text-white ${confirmColor} rounded-lg transition-colors`}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PC→CNC 전송 확인 다이얼로그 (O번호 편집 + 중복 체크)
// ============================================================

interface PcToCncEntry {
  fileName: string;
  contentProgramNo: string;  // content에서 파싱한 O번호 (숫자만, ex "7001")
  targetProgramNo: string;   // 실제 전송될 O번호 (사용자 편집 가능)
  isEditing: boolean;
  editingValue: string;
}

function parseOFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const m = base.match(/O?(\d+)/i);
  return m ? m[1].replace(/^0+(\d)/, '$1') : '';
}

function parseOFromContent(content: string): string {
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t === '%') continue;
    const m = t.match(/^O(\d+)/i);
    if (m) return m[1].replace(/^0+(\d)/, '$1');
    break;
  }
  return '';
}

function formatONo(no: string): string {
  const n = parseInt(no, 10);
  return isNaN(n) ? no : `O${n.toString().padStart(4, '0')}`;
}

interface PcToCncConfirmDialogProps {
  entries: PcToCncEntry[];
  loading: boolean;
  onUpdateEntry: (fileName: string, update: Partial<PcToCncEntry>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function PcToCncConfirmDialog({ entries, loading, onUpdateEntry, onConfirm, onCancel }: PcToCncConfirmDialogProps) {
  const anyEditing = entries.some((e) => e.isEditing);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col border border-gray-600">
        <div className="px-5 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">전송 확인</h3>
          <p className="text-xs text-blue-400 mt-0.5">PC → CNC</p>
        </div>

        <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto">
          {/* 헤더 행 */}
          <div className="grid grid-cols-[1fr_16px_1fr_56px] gap-2 text-[11px] text-gray-500 mb-2 px-1">
            <span>PC 파일</span>
            <span />
            <span>CNC 저장 번호</span>
            <span />
          </div>

          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.fileName}
                className="grid grid-cols-[1fr_16px_1fr_56px] gap-2 items-center bg-gray-900 rounded px-3 py-2"
              >
                {/* PC 파일명 */}
                <span className="text-sm text-white font-mono truncate" title={entry.fileName}>
                  {entry.fileName}
                </span>

                {/* 화살표 */}
                <span className="text-gray-500 text-xs text-center">→</span>

                {/* CNC 저장 번호 */}
                {entry.isEditing ? (
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-blue-400 text-sm font-mono shrink-0">O</span>
                    <input
                      type="text"
                      value={entry.editingValue}
                      onChange={(e) =>
                        onUpdateEntry(entry.fileName, { editingValue: e.target.value.replace(/\D/g, '').slice(0, 4) })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          onUpdateEntry(entry.fileName, { targetProgramNo: entry.editingValue || entry.targetProgramNo, isEditing: false });
                        if (e.key === 'Escape')
                          onUpdateEntry(entry.fileName, { isEditing: false });
                      }}
                      className="w-full bg-gray-700 text-white font-mono text-sm px-2 py-0.5 rounded border border-blue-500 outline-none"
                      maxLength={4}
                      autoFocus
                    />
                  </div>
                ) : (
                  <span
                    className={`text-sm font-mono ${
                      loading
                        ? 'text-gray-500'
                        : entry.targetProgramNo !== entry.contentProgramNo
                        ? 'text-yellow-400'
                        : 'text-green-400'
                    }`}
                  >
                    {loading ? '...' : formatONo(entry.targetProgramNo)}
                  </span>
                )}

                {/* 편집/저장 버튼 */}
                {entry.isEditing ? (
                  <button
                    onClick={() =>
                      onUpdateEntry(entry.fileName, { targetProgramNo: entry.editingValue || entry.targetProgramNo, isEditing: false })
                    }
                    className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded"
                  >
                    저장
                  </button>
                ) : (
                  <button
                    disabled={loading}
                    onClick={() =>
                      onUpdateEntry(entry.fileName, { isEditing: true, editingValue: entry.targetProgramNo })
                    }
                    className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded disabled:opacity-40"
                  >
                    편집
                  </button>
                )}
              </div>
            ))}
          </div>

          {loading && (
            <p className="text-xs text-gray-500 mt-3 text-center">프로그램 번호 확인 중...</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-700 flex items-center justify-end gap-3">
          <button
            onClick={onConfirm}
            disabled={loading || anyEditing}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            전송 실행
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function OverwriteConfirmDialog({
  conflicts,
  onConfirm,
  onCancel,
}: {
  conflicts: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
      <div className="bg-gray-800 rounded-lg shadow-xl w-96 flex flex-col border border-red-700">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
          <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <h3 className="text-lg font-semibold text-white">덮어쓰기 확인</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-300 mb-3">다음 프로그램이 이미 NC에 존재합니다:</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {conflicts.map((c) => (
              <span key={c} className="px-2 py-1 bg-red-900/40 text-red-300 font-mono text-sm rounded border border-red-700/50">
                {c}
              </span>
            ))}
          </div>
          <p className="text-sm text-yellow-400">기존 프로그램을 삭제 후 덮어쓰겠습니까?</p>
        </div>
        <div className="px-5 py-3 border-t border-gray-700 flex items-center justify-end gap-3">
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            덮어쓰기
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            취소
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
    loadFileHistory,
    openViewer,
  } = useFileStore();

  const dncConfig = useDncConfig(machineId);
  const pathCount = dncConfig?.pathCount || 2;

  const [cncPath, setCncPath] = useState<'path1' | 'path2' | 'path3'>('path1');

  // CNC→PC 확인 다이얼로그
  const [confirmDialog, setConfirmDialog] = useState<{
    direction: TransferDirection;
    fileNames: string[];
    cncPath?: 'path1' | 'path2' | 'path3';
  } | null>(null);

  // PC→CNC 확인 다이얼로그 (O번호 편집)
  const [pcToCncConfirm, setPcToCncConfirm] = useState<{
    entries: PcToCncEntry[];
    loading: boolean;
  } | null>(null);

  // 덮어쓰기 2차 확인
  const [overwriteConfirm, setOverwriteConfirm] = useState<{
    conflicts: string[];
    onConfirm: () => void;
  } | null>(null);

  const [downloadConfirm, setDownloadConfirm] = useState<{ fileNames: string[] } | null>(null);
  const [deleteConfirm, setDeleteConfirm]   = useState<{ fileNames: string[] } | null>(null);

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
    setConfirmDialog({ direction: 'CNC_TO_PC', fileNames: selectedCncFiles, cncPath });
  }, [selectedCncFiles, cncPath]);

  // ← (왼쪽): PC → CNC — O번호 파싱 후 확인 다이얼로그
  const handleTransferLeft = useCallback(() => {
    if (selectedShareFiles.length === 0) return;
    const initial: PcToCncEntry[] = selectedShareFiles.map((fileName) => {
      const no = parseOFromFilename(fileName);
      return { fileName, contentProgramNo: no, targetProgramNo: no, isEditing: false, editingValue: '' };
    });
    setPcToCncConfirm({ entries: initial, loading: true });
    void (async () => {
      const results = await Promise.all(
        selectedShareFiles.map(async (fileName) => {
          try {
            const res = await fileApi.readFile('TRANSFER_SHARE', '', fileName);
            const content = (res.success ? (res.data as { content?: string })?.content : null) ?? '';
            const no = parseOFromContent(content) || parseOFromFilename(fileName);
            return { fileName, no };
          } catch {
            return { fileName, no: parseOFromFilename(fileName) };
          }
        })
      );
      setPcToCncConfirm((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              entries: prev.entries.map((e) => {
                const r = results.find((r) => r.fileName === e.fileName);
                return r ? { ...e, contentProgramNo: r.no, targetProgramNo: r.no } : e;
              }),
            }
          : null
      );
    })();
  }, [selectedShareFiles]);

  // PC→CNC 전송 실행 (중복 체크 → 필요 시 2차 다이얼로그)
  const handleConfirmPcToCnc = useCallback(() => {
    if (!pcToCncConfirm) return;
    const entries = pcToCncConfirm.entries;
    const targetProgramNos: Record<string, string> = {};
    entries.forEach((e) => { targetProgramNos[e.fileName] = e.targetProgramNo; });

    const conflicts = entries.filter((e) => {
      const targetNum = parseInt(e.targetProgramNo.replace(/^O/i, ''), 10);
      return !isNaN(targetNum) && cncFiles.some((f) => {
        const cncNum = parseInt((f.programNo ?? f.name ?? '').replace(/^O/i, ''), 10);
        return cncNum === targetNum;
      });
    });

    const doTransfer = (overwrite: boolean) => {
      const userName = user?.username || 'unknown';
      const pathNo = cncPath === 'path2' ? 2 : cncPath === 'path3' ? 3 : 1;
      startTransfer('PC_TO_CNC', entries.map((e) => e.fileName), machineId, userName, pathNo, targetProgramNos, overwrite);
      setPcToCncConfirm(null);
      setOverwriteConfirm(null);
    };

    if (conflicts.length > 0) {
      setOverwriteConfirm({
        conflicts: conflicts.map((e) => formatONo(e.targetProgramNo)),
        onConfirm: () => doTransfer(true),
      });
      return;
    }
    doTransfer(false);
  }, [pcToCncConfirm, cncFiles, cncPath, machineId, startTransfer, user]);

  // CNC→PC 확인 다이얼로그에서 전송 실행
  const handleConfirmTransfer = useCallback(() => {
    if (!confirmDialog) return;
    const userName = user?.username || 'unknown';
    const pathNo = confirmDialog.cncPath === 'path2' ? 2 : confirmDialog.cncPath === 'path3' ? 3 : 1;
    startTransfer(confirmDialog.direction, confirmDialog.fileNames, machineId, userName, pathNo);
    setConfirmDialog(null);
  }, [confirmDialog, machineId, startTransfer, user]);

  const handleShareUpload = useCallback(async (file: File) => {
    try {
      const res = await fileApi.uploadShareFile(file, machineId);
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
    void loadFileHistory(machineId);
  }, [uploadToShare, loadShareFiles, loadFileHistory, machineId]);

  const handleShareDelete = useCallback((fileNames: string[]) => {
    setDeleteConfirm({ fileNames });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteConfirm) return;
    deleteFromShare(deleteConfirm.fileNames, machineId);
    setDeleteConfirm(null);
  }, [deleteConfirm, deleteFromShare, machineId]);

  const execDownload = useCallback(async (fileNames: string[]) => {
    for (const fileName of fileNames) {
      try {
        const res = await fileApi.readFile('TRANSFER_SHARE', '', fileName);
        if (!res.success) {
          const errMsg = (res as { error?: { message?: string } }).error?.message ?? '파일 읽기 실패';
          alert(`다운로드 실패: ${fileName}\n${errMsg}`);
          continue;
        }
        const content = (res.data as { content?: string })?.content ?? '';
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);
      } catch {
        console.error(`Download failed: ${fileName}`);
      }
    }
  }, []);

  const handleShareDownload = useCallback((fileNames: string[]) => {
    setDownloadConfirm({ fileNames });
  }, []);

  const handleConfirmDownload = useCallback(async () => {
    if (!downloadConfirm) return;
    setDownloadConfirm(null);
    await execDownload(downloadConfirm.fileNames);
  }, [downloadConfirm, execDownload]);

  const handleShareDoubleClick = useCallback(async (file: FileEntry) => {
    openViewer(file.name, '파일을 읽는 중...', false, 'TRANSFER_SHARE', machineId);
    try {
      const res = await fileApi.readFile('TRANSFER_SHARE', '', file.name);
      if (!res.success) {
        const fallback = MOCK_GCODE_CONTENT[file.name] ?? '';
        openViewer(file.name, fallback || `오류: ${(res as { error?: { message?: string } }).error?.message ?? '파일 읽기 실패'}`, false, 'TRANSFER_SHARE', machineId);
        return;
      }
      const content = (res.data as { content?: string })?.content ?? '';
      openViewer(file.name, content || '(내용 없음)', false, 'TRANSFER_SHARE', machineId);
    } catch {
      const fallback = MOCK_GCODE_CONTENT[file.name] ?? '';
      openViewer(file.name, fallback || '파일을 읽을 수 없습니다', false, 'TRANSFER_SHARE', machineId);
    }
  }, [openViewer, machineId]);

  const handleCncDoubleClick = useCallback(async (file: FileEntry) => {
    const match = file.name.match(/O?(\d+)/i);
    if (!match) return;
    const programNo = parseInt(match[1], 10);
    const pathNo = cncPath === 'path2' ? 2 : cncPath === 'path3' ? 3 : 1;

    openViewer(file.name, '프로그램을 읽는 중...', true, 'CNC_LOCAL', machineId);
    const res = await fileApi.readCncProgram(machineId, programNo, pathNo);
    if (!res.success) {
      openViewer(file.name, `오류: ${res.error?.message ?? '프로그램 읽기 실패'}`, true, 'CNC_LOCAL', machineId);
      return;
    }
    const content = (res.data as { content?: string })?.content ?? '';
    openViewer(file.name, content || '(내용 없음)', true, 'CNC_LOCAL', machineId);
  }, [openViewer, machineId, cncPath]);

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
    <div className="flex-1 flex flex-col min-h-0 gap-3 max-lg:portrait:min-h-0">
      {/* 2분할 패널: 좌 5 : 우 5 */}
      <div className="flex-[4_1_0%] grid grid-cols-[1fr_auto_1fr] gap-0 min-h-0 max-lg:portrait:grid-cols-1 max-lg:portrait:grid-rows-[minmax(18rem,auto)_auto_minmax(18rem,auto)] max-lg:portrait:gap-3">
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
          className="max-lg:portrait:min-h-[18rem]"
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
          onDownload={handleShareDownload}
          onDelete={canTransfer ? handleShareDelete : undefined}
          onUpload={canTransfer ? handleShareUpload : undefined}
          pathComment={pcPathComment}
          className="max-lg:portrait:min-h-[18rem]"
        />
      </div>

      {/* 전송 큐 */}
      <div className="flex-1 min-h-[4rem] overflow-hidden">
        <TransferQueuePanel machineId={machineId} />
      </div>

      {/* PC→CNC O번호 편집 확인 다이얼로그 */}
      {pcToCncConfirm && (
        <PcToCncConfirmDialog
          entries={pcToCncConfirm.entries}
          loading={pcToCncConfirm.loading}
          onUpdateEntry={(fileName, update) =>
            setPcToCncConfirm((prev) =>
              prev
                ? { ...prev, entries: prev.entries.map((e) => (e.fileName === fileName ? { ...e, ...update } : e)) }
                : null
            )
          }
          onConfirm={handleConfirmPcToCnc}
          onCancel={() => setPcToCncConfirm(null)}
        />
      )}

      {/* 덮어쓰기 2차 확인 다이얼로그 */}
      {overwriteConfirm && (
        <OverwriteConfirmDialog
          conflicts={overwriteConfirm.conflicts}
          onConfirm={overwriteConfirm.onConfirm}
          onCancel={() => setOverwriteConfirm(null)}
        />
      )}

      {/* CNC→PC 전송 확인 다이얼로그 */}
      {confirmDialog && (
        <TransferConfirmDialog
          direction={confirmDialog.direction}
          fileNames={confirmDialog.fileNames}
          cncPath={confirmDialog.cncPath}
          onConfirm={handleConfirmTransfer}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* 다운로드 확인 다이얼로그 */}
      {downloadConfirm && (
        <SimpleConfirmDialog
          title="내 PC로 저장"
          description="선택한 파일을 PC로 다운로드합니다."
          fileNames={downloadConfirm.fileNames}
          confirmLabel="다운로드"
          confirmColor="bg-green-600 hover:bg-green-700"
          onConfirm={handleConfirmDownload}
          onCancel={() => setDownloadConfirm(null)}
        />
      )}

      {/* 삭제 확인 다이얼로그 */}
      {deleteConfirm && (
        <SimpleConfirmDialog
          title="파일 삭제"
          description="삭제된 파일은 복구할 수 없습니다."
          fileNames={deleteConfirm.fileNames}
          confirmLabel="삭제"
          confirmColor="bg-red-600 hover:bg-red-700"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteConfirm(null)}
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

  // WS: backup_completed / backup_failed 이벤트 수신 시 이력 갱신
  const loadBackupsRef = useRef(loadBackups);
  loadBackupsRef.current = loadBackups;
  const setErrorRef = useRef(setError);
  setErrorRef.current = setError;
  useEffect(() => {
    return wsClient.onMessage((msg) => {
      if (msg.type === 'backup_completed' || msg.type === 'backup_failed') {
        void loadBackupsRef.current();
      }
      if (msg.type === 'backup_failed') {
        const p = msg.payload as { errorMessage?: string; errorCode?: string } | undefined;
        setErrorRef.current(p?.errorMessage || p?.errorCode || '백업 처리 중 오류가 발생했습니다');
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
      } else {
        setError('백업 파일을 찾을 수 없습니다 (서버 재시작 후 이력이 초기화되었을 수 있습니다)');
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
                      <BackupProgressStatus status={backup.status} />
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

function BackupProgressStatus({ status }: { status: BackupRecord['status'] }) {
  if (status === 'FAILED') {
    return <span className="text-xs text-red-400">실패</span>;
  }

  return (
    <div className="min-w-[7rem] max-w-[10rem]">
      <div className="flex items-center justify-between text-[11px] text-yellow-400 mb-1">
        <span>처리 중</span>
        <span>{status}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden">
        <div className="h-full w-2/3 rounded-full bg-yellow-500 animate-pulse" />
      </div>
    </div>
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

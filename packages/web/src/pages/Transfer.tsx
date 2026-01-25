// Transfer Page - Program Upload/Download and Backup

import { useState, useEffect, useCallback } from 'react';
import { useMachineStore } from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { transferApi, backupApi } from '../lib/api';

type TransferTab = 'upload' | 'download' | 'backup';

interface ProgramFile {
  name: string;
  number: string;
  size: number;
  modifiedAt: string;
}

interface BackupRecord {
  id: string;
  machineId: string;
  type: 'SRAM' | 'PARAMETER' | 'PROGRAM' | 'FULL';
  fileName: string;
  fileSize: number;
  createdAt: string;
  createdBy: string;
}

export function Transfer() {
  const user = useAuthStore((state) => state.user);
  const machines = useMachineStore((state) => state.machines);
  const selectedMachineId = useMachineStore((state) => state.selectedMachineId);

  const [activeTab, setActiveTab] = useState<TransferTab>('upload');
  const [machineId, setMachineId] = useState(selectedMachineId || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgramNo, setUploadProgramNo] = useState('');

  // Download state
  const [cncPrograms, setCncPrograms] = useState<ProgramFile[]>([]);
  const [selectedPrograms, setSelectedPrograms] = useState<string[]>([]);

  // Backup state
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupType, setBackupType] = useState<'SRAM' | 'PARAMETER' | 'PROGRAM' | 'FULL'>('FULL');

  const canTransfer = user?.role === 'ADMIN' || user?.role === 'AS';

  // Load CNC programs
  const loadCncPrograms = useCallback(async () => {
    if (!machineId) return;
    setIsLoading(true);
    try {
      const response = await transferApi.listPrograms(machineId);
      if (response.success && response.data) {
        setCncPrograms(response.data as ProgramFile[]);
      }
    } catch (err) {
      console.error('Failed to load programs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [machineId]);

  // Load backup history
  const loadBackups = useCallback(async () => {
    if (!machineId) return;
    setIsLoading(true);
    try {
      const response = await backupApi.getHistory(machineId);
      if (response.success && response.data) {
        setBackups(response.data as BackupRecord[]);
      }
    } catch (err) {
      console.error('Failed to load backups:', err);
    } finally {
      setIsLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    if (machineId) {
      if (activeTab === 'download') {
        loadCncPrograms();
      } else if (activeTab === 'backup') {
        loadBackups();
      }
    }
  }, [machineId, activeTab, loadCncPrograms, loadBackups]);

  // Handle upload
  const handleUpload = async () => {
    if (!machineId || !uploadFile) return;

    setError(null);
    setSuccess(null);
    setIsLoading(true);

    try {
      const response = await transferApi.upload(machineId, uploadFile, uploadProgramNo || undefined);
      if (response.success) {
        setSuccess('프로그램 업로드 완료');
        setUploadFile(null);
        setUploadProgramNo('');
      } else {
        setError(response.error?.message || '업로드 실패');
      }
    } catch (err) {
      setError('서버 연결 오류');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle download
  const handleDownload = async () => {
    if (!machineId || selectedPrograms.length === 0) return;

    setError(null);
    setSuccess(null);
    setIsLoading(true);

    try {
      for (const programNo of selectedPrograms) {
        const response = await transferApi.download(machineId, programNo);
        if (response.success && response.data) {
          // Create download link
          const blob = new Blob([response.data as string], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `O${programNo}.nc`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
      setSuccess(`${selectedPrograms.length}개 프로그램 다운로드 완료`);
      setSelectedPrograms([]);
    } catch (err) {
      setError('다운로드 실패');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle backup
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
    } catch (err) {
      setError('서버 연결 오류');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle backup download
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
    } catch (err) {
      setError('백업 다운로드 실패');
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          프로그램 전송
        </h1>
        <p className="text-gray-500">NC 프로그램 업로드/다운로드 및 백업</p>
      </div>

      {/* Machine Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          장비 선택
        </label>
        <select
          value={machineId}
          onChange={(e) => setMachineId(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                   bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="">장비를 선택하세요</option>
          {machines.map((machine) => (
            <option key={machine.id} value={machine.machineId}>
              {machine.name}
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded-lg">
          {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
        {[
          { id: 'upload', label: 'INPUT (업로드)', icon: UploadIcon },
          { id: 'download', label: 'OUTPUT (다운로드)', icon: DownloadIcon },
          { id: 'backup', label: '백업', icon: BackupIcon },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TransferTab)}
            className={`flex items-center gap-2 px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon className="w-5 h-5" />
            {tab.label}
          </button>
        ))}
      </div>

      {!machineId ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center text-gray-500">
          장비를 선택해주세요
        </div>
      ) : (
        <>
          {/* Upload Tab */}
          {activeTab === 'upload' && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                프로그램 업로드 (Server → CNC)
              </h2>

              <div className="space-y-4">
                {/* File Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    NC 파일 선택
                  </label>
                  <input
                    type="file"
                    accept=".nc,.txt"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4
                             file:rounded file:border-0 file:bg-blue-600 file:text-white
                             hover:file:bg-blue-700"
                  />
                </div>

                {/* Program Number */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    프로그램 번호 (선택)
                  </label>
                  <input
                    type="text"
                    value={uploadProgramNo}
                    onChange={(e) => setUploadProgramNo(e.target.value)}
                    placeholder="예: 1234 (파일명에서 자동 추출)"
                    className="w-full max-w-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                             bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Upload Button */}
                <button
                  onClick={handleUpload}
                  disabled={!canTransfer || !uploadFile || isLoading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                           disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isLoading ? '업로드 중...' : '업로드'}
                </button>
              </div>
            </div>
          )}

          {/* Download Tab */}
          {activeTab === 'download' && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                프로그램 다운로드 (CNC → Server)
              </h2>

              <div className="mb-4 flex justify-between items-center">
                <button
                  onClick={loadCncPrograms}
                  className="text-blue-600 hover:text-blue-700 text-sm"
                >
                  새로고침
                </button>
                <button
                  onClick={handleDownload}
                  disabled={!canTransfer || selectedPrograms.length === 0 || isLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                           disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                >
                  선택 다운로드 ({selectedPrograms.length})
                </button>
              </div>

              <div className="overflow-auto max-h-96">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                    <tr>
                      <th className="w-12 px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selectedPrograms.length === cncPrograms.length && cncPrograms.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPrograms(cncPrograms.map((p) => p.number));
                            } else {
                              setSelectedPrograms([]);
                            }
                          }}
                          className="w-4 h-4"
                        />
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        프로그램
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        크기
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        수정일
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                    {isLoading ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                          로딩 중...
                        </td>
                      </tr>
                    ) : cncPrograms.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                          프로그램이 없습니다
                        </td>
                      </tr>
                    ) : (
                      cncPrograms.map((program) => (
                        <tr key={program.number} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={selectedPrograms.includes(program.number)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPrograms([...selectedPrograms, program.number]);
                                } else {
                                  setSelectedPrograms(selectedPrograms.filter((p) => p !== program.number));
                                }
                              }}
                              className="w-4 h-4"
                            />
                          </td>
                          <td className="px-4 py-2 font-mono text-gray-900 dark:text-white">
                            O{program.number}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-500">
                            {formatFileSize(program.size)}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-500">
                            {new Date(program.modifiedAt).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Backup Tab */}
          {activeTab === 'backup' && (
            <div className="space-y-6">
              {/* Create Backup */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  새 백업 생성
                </h2>

                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      백업 유형
                    </label>
                    <select
                      value={backupType}
                      onChange={(e) => setBackupType(e.target.value as typeof backupType)}
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                               bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700
                             disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isLoading ? '백업 중...' : '백업 시작'}
                  </button>
                </div>
              </div>

              {/* Backup History */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  백업 이력
                </h2>

                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        유형
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        파일명
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        크기
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        생성일
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        생성자
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        작업
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                    {backups.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                          백업 이력이 없습니다
                        </td>
                      </tr>
                    ) : (
                      backups.map((backup) => (
                        <tr key={backup.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-2">
                            <BackupTypeBadge type={backup.type} />
                          </td>
                          <td className="px-4 py-2 font-mono text-sm text-gray-900 dark:text-white">
                            {backup.fileName}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-500">
                            {formatFileSize(backup.fileSize)}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-500">
                            {new Date(backup.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-500">
                            {backup.createdBy}
                          </td>
                          <td className="px-4 py-2">
                            <button
                              onClick={() => handleBackupDownload(backup.id, backup.fileName)}
                              className="text-blue-600 hover:text-blue-700 text-sm"
                            >
                              다운로드
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!canTransfer && (
        <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-sm text-yellow-700 dark:text-yellow-400">
            프로그램 전송 권한이 없습니다. 관리자 또는 AS 담당자에게 문의하세요.
          </p>
        </div>
      )}
    </div>
  );
}

// Helper Components
function BackupTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    FULL: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    SRAM: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    PARAMETER: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    PROGRAM: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
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

// Icons
function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
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

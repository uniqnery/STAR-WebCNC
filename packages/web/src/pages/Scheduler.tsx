// Scheduler Page - 스케줄러 (Job Scheduling with NC Monitor)

import { useState, useEffect, useCallback } from 'react';
import {
  useMachineStore,
  useMachineTelemetry,
  useFocasEvents,
  useSchedulerJobs,
  useDncConfig,
  useControlLock,
  SchedulerJob,
  MachineDncConfig,
  DncPathConfig,
} from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { schedulerApi, dncApi } from '../lib/api';
import { NCMonitor } from '../components/NCMonitor';
import { FocasEventLog } from '../components/FocasEventLog';
import { FolderBrowser } from '../components/FolderBrowser';
import { GCodeViewer } from '../components/filemanager/GCodeViewer';
import { MachineTopBar } from '../components/MachineTopBar';

export function Scheduler() {
  const user = useAuthStore((state) => state.user);
  const { selectedMachineId, setSchedulerJobs, clearSchedulerJobs, setDncConfig } = useMachineStore();
  const machines = useMachineStore((s) => s.machines);
  const telemetry = useMachineTelemetry(selectedMachineId || '');
  const focasEvents = useFocasEvents(selectedMachineId || '');
  const jobs = useSchedulerJobs(selectedMachineId || '');
  const dncConfig = useDncConfig(selectedMachineId || '');
  const controlLock = useControlLock(selectedMachineId || '');

  const [, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [editingPathKey, setEditingPathKey] = useState<'path1' | 'path2' | 'path3'>('path1');

  const machine = machines.find((m) => m.machineId === selectedMachineId);
  const isAdmin = user?.role === 'ADMIN';
  const hasControlLock = controlLock?.isOwner ?? false;
  const isSchedulerRunning = jobs.some((j) => j.status === 'RUNNING');
  const pathCount = machine?.pathCount || 2;

  // DNC config 서버에서 로드 (마운트 시 + 장비 변경 시)
  useEffect(() => {
    if (!selectedMachineId) return;
    dncApi.getConfig(selectedMachineId).then((res) => {
      if (res.success && res.data) {
        const d = res.data as { machineId: string; dncConfig: { path1?: string; path2?: string; path3?: string } };
        if (d.dncConfig && (d.dncConfig.path1 !== undefined || d.dncConfig.path2 !== undefined)) {
          setDncConfig(selectedMachineId, {
            machineId: selectedMachineId,
            pathCount,
            dncPaths: { path1: d.dncConfig.path1 || '', path2: d.dncConfig.path2 || '', path3: d.dncConfig.path3 },
          });
        }
      }
    }).catch(() => { /* 서버 미연결 시 localStorage 유지 */ });
  }, [selectedMachineId]);

  // 작업 목록 로드
  const loadJobs = useCallback(async () => {
    if (!selectedMachineId) return;
    setIsLoading(true);
    try {
      const response = await schedulerApi.getJobs();
      if (response.success && response.data) {
        type ServerJob = {
          id: string; machineId: string; status: string;
          programNo?: string; mainProgramNo?: string; subProgramNo?: string;
          targetCount?: number; preset?: number;
          completedCount?: number; count?: number;
        };
        const raw = (response.data as { items?: ServerJob[] }).items
          ?? (response.data as ServerJob[]);
        const mapped: SchedulerJob[] = raw
          .filter((j) => j.machineId === selectedMachineId)
          .map((j) => ({
            id: j.id,
            machineId: j.machineId,
            mainProgramNo: j.mainProgramNo ?? j.programNo ?? '',
            subProgramNo: j.subProgramNo ?? '',
            preset: j.preset ?? j.targetCount ?? 1,
            count: j.count ?? j.completedCount ?? 0,
            status: j.status as SchedulerJob['status'],
          }));
        setSchedulerJobs(selectedMachineId, mapped);
      }
    } catch (err) {
      console.error('Failed to load jobs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedMachineId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // 행 추가
  const handleAddRow = () => {
    const newJob: SchedulerJob = {
      id: `new-${Date.now()}`,
      machineId: selectedMachineId || '',
      mainProgramNo: '',
      subProgramNo: '',
      preset: 1,
      count: 0,
      status: 'PENDING',
    };
    setSchedulerJobs(selectedMachineId || '', [...jobs, newJob]);
  };

  // 행 삭제
  const handleDeleteRow = (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId);
    if (job?.status === 'RUNNING') {
      setError('실행 중인 작업은 삭제할 수 없습니다');
      return;
    }
    setSchedulerJobs(selectedMachineId || '', jobs.filter((j) => j.id !== jobId));
  };

  // 행 업데이트
  const handleUpdateRow = (jobId: string, field: keyof SchedulerJob, value: string | number) => {
    setSchedulerJobs(selectedMachineId || '', jobs.map((j) => (j.id === jobId ? { ...j, [field]: value } : j)));
  };

  // 현재 실행 중인 작업
  const currentJob = jobs.find((j) => j.status === 'RUNNING');

  // DNC 경로 설정 (Settings dropdown content)
  const dncSettingsContent = (
    <DncSettingsContent
      pathCount={pathCount}
      dncConfig={dncConfig}
      isAdmin={isAdmin}
      isSchedulerRunning={isSchedulerRunning}
      onOpenFolderBrowser={(pathKey) => {
        setEditingPathKey(pathKey);
        setFolderBrowserOpen(true);
      }}
      onSave={(paths) => {
        if (!selectedMachineId) return;
        const config: MachineDncConfig = {
          machineId: selectedMachineId,
          pathCount,
          dncPaths: paths,
          updatedAt: new Date().toISOString(),
          updatedBy: user?.username,
        };
        setDncConfig(selectedMachineId, config);
        // 서버에도 저장 (실패 시 로컬만 반영)
        dncApi.saveConfig(selectedMachineId, { path1: paths.path1, path2: paths.path2, path3: paths.path3 }).catch(() => null);
      }}
    />
  );

  return (
    <div className="p-6 space-y-4">
      {/* MachineTopBar: 장비선택 + 경광등 + 인터록 + 제어권 + DNC 설정 */}
      <MachineTopBar
        pageTitle="스케줄러"
        pageId="scheduler"
        settingsContent={dncSettingsContent}
      />

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-100 text-red-700 rounded-lg flex justify-between items-center">
          {error}
          <button onClick={() => setError(null)} className="text-red-700 hover:text-red-900">✕</button>
        </div>
      )}

      {/* FolderBrowser 모달 */}
      <FolderBrowser
        isOpen={folderBrowserOpen}
        currentPath={dncConfig?.dncPaths[editingPathKey] || undefined}
        onSelect={(path) => {
          setFolderBrowserOpen(false);
          if (!selectedMachineId) return;
          const currentPaths: DncPathConfig = dncConfig?.dncPaths || { path1: '', path2: '' };
          const updatedPaths = { ...currentPaths, [editingPathKey]: path };
          const config: MachineDncConfig = {
            machineId: selectedMachineId,
            pathCount,
            dncPaths: updatedPaths,
            updatedAt: new Date().toISOString(),
            updatedBy: user?.username,
          };
          setDncConfig(selectedMachineId, config);
          // 서버에도 저장
          dncApi.saveConfig(selectedMachineId, { path1: updatedPaths.path1, path2: updatedPaths.path2, path3: updatedPaths.path3 }).catch(() => null);
        }}
        onClose={() => setFolderBrowserOpen(false)}
      />

      {/* 2분할 레이아웃: NC 모니터 / 스케줄러 테이블 (5:5) */}
      {selectedMachineId && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 좌측: NC 모니터 */}
            <div className="h-[580px]">
              <NCMonitor
                path1={telemetry?.path1}
                path2={telemetry?.path2}
                machineMode={telemetry?.mode ? `PROGRAM( ${telemetry.mode} )` : undefined}
                machineId={selectedMachineId || undefined}
              />
            </div>

            {/* 우측: 스케줄러 테이블 */}
            <div className="bg-gray-800 text-white rounded-lg shadow p-4 flex flex-col h-[580px]">
              {/* 현재 실행 중인 작업 */}
              <div className="mb-4 p-3 bg-gray-700 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-400">현재 실행:</span>
                    <span className="font-mono font-medium text-white">
                      {currentJob ? `${currentJob.mainProgramNo} / ${currentJob.subProgramNo}` : '-'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={!hasControlLock || !currentJob}
                      className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ▶ 실행
                    </button>
                    <button
                      disabled={!hasControlLock || !currentJob}
                      className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ■ 정지
                    </button>
                  </div>
                </div>
              </div>

              {/* 작업 테이블 */}
              <div className="overflow-auto flex-1 min-h-0">
                <table className="w-full text-sm">
                  <thead className="bg-gray-700 sticky top-0">
                    <tr className="text-gray-300">
                      <th className="px-2 py-2 text-center w-10">No.</th>
                      <th className="px-2 py-2 text-left">메인PGM</th>
                      <th className="px-2 py-2 text-left">서브PGM</th>
                      <th className="px-2 py-2 text-center">PRESET</th>
                      <th className="px-2 py-2 text-center">COUNT</th>
                      <th className="px-2 py-2 text-center">상태</th>
                      <th className="px-2 py-2 text-center">삭제</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-600">
                    {jobs.map((job, index) => (
                      <tr key={job.id} className={job.status === 'RUNNING' ? 'bg-green-900/20' : ''}>
                        <td className="px-2 py-2 text-center text-gray-400 font-mono">{index + 1}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center">
                            <span className="font-mono text-sm text-gray-400 mr-0.5">O</span>
                            <input
                              type="text"
                              value={(job.mainProgramNo ?? '').replace(/^O/i, '')}
                              onChange={(e) => {
                                const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                                handleUpdateRow(job.id, 'mainProgramNo', digits ? `O${digits}` : '');
                              }}
                              disabled={job.status === 'RUNNING'}
                              className="w-16 px-1 py-1 border border-gray-600 rounded font-mono text-sm bg-gray-700 text-white disabled:opacity-50"
                              placeholder="0001"
                              maxLength={4}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center">
                            <span className="font-mono text-sm text-gray-400 mr-0.5">O</span>
                            <input
                              type="text"
                              value={(job.subProgramNo ?? '').replace(/^O/i, '')}
                              onChange={(e) => {
                                const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                                handleUpdateRow(job.id, 'subProgramNo', digits ? `O${digits}` : '');
                              }}
                              disabled={job.status === 'RUNNING'}
                              className="w-16 px-1 py-1 border border-gray-600 rounded font-mono text-sm bg-gray-700 text-white disabled:opacity-50"
                              placeholder="9001"
                              maxLength={4}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="number"
                            value={job.preset}
                            onChange={(e) => handleUpdateRow(job.id, 'preset', parseInt(e.target.value) || 0)}
                            disabled={job.status === 'RUNNING'}
                            className="w-16 px-2 py-1 border border-gray-600 rounded text-sm text-center bg-gray-700 text-white disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-white">
                          {job.count}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <JobStatusBadge status={job.status} />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={() => handleDeleteRow(job.id)}
                            disabled={job.status === 'RUNNING'}
                            className="text-red-400 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 행 추가 / 초기화 버튼 */}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAddRow}
                  disabled={!hasControlLock}
                  className="flex-1 py-2 border-2 border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  + 행 추가
                </button>
                <button
                  onClick={() => clearSchedulerJobs(selectedMachineId || '')}
                  disabled={!hasControlLock || jobs.length === 0}
                  className="px-4 py-2 border border-gray-600 rounded-lg text-gray-400 hover:border-red-500 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  초기화
                </button>
              </div>
            </div>
          </div>

          {/* FOCAS 이벤트 로그 */}
          <FocasEventLog events={focasEvents} />

          {/* G-Code 뷰어 모달 */}
          <GCodeViewer />
        </>
      )}
    </div>
  );
}

// DNC 경로 설정 (Settings dropdown 내용)
function DncSettingsContent({
  pathCount,
  dncConfig,
  isAdmin,
  isSchedulerRunning,
  onOpenFolderBrowser,
  onSave,
}: {
  pathCount: number;
  dncConfig?: MachineDncConfig;
  isAdmin: boolean;
  isSchedulerRunning: boolean;
  onOpenFolderBrowser: (pathKey: 'path1' | 'path2' | 'path3') => void;
  onSave: (paths: DncPathConfig) => void;
}) {
  const paths = dncConfig?.dncPaths || { path1: '', path2: '' };
  const canEdit = isAdmin && !isSchedulerRunning;

  const pathEntries: { key: 'path1' | 'path2' | 'path3'; label: string }[] = [
    { key: 'path1', label: 'Path 1' },
    { key: 'path2', label: 'Path 2' },
  ];
  if (pathCount >= 3) {
    pathEntries.push({ key: 'path3', label: 'Path 3' });
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-gray-900 dark:text-white">
        DNC 경로 설정
      </div>

      {isSchedulerRunning && isAdmin && (
        <div className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 rounded">
          스케줄러 실행 중에는 경로를 변경할 수 없습니다
        </div>
      )}
      {!isAdmin && (
        <div className="text-xs text-gray-500 px-1">
          관리자만 경로를 변경할 수 있습니다 (읽기 전용)
        </div>
      )}

      {pathEntries.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400 w-14 flex-shrink-0 font-medium">
            {label}
          </span>
          <div className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded text-sm font-mono text-gray-700 dark:text-gray-300 truncate min-h-[36px] flex items-center">
            {paths[key] || (
              <span className="text-gray-400 italic">미설정</span>
            )}
          </div>
          <button
            onClick={() => onOpenFolderBrowser(key)}
            disabled={!canEdit}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            선택
          </button>
        </div>
      ))}

      {/* 저장 / 초기화 */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={() => onSave({ path1: '', path2: '', ...(pathCount >= 3 ? { path3: '' } : {}) })}
          disabled={!canEdit}
          className="px-3 py-1.5 text-xs text-gray-500 hover:text-red-500 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          경로 초기화
        </button>
      </div>

      {/* 마지막 수정 정보 */}
      {dncConfig?.updatedAt && (
        <div className="text-xs text-gray-400 text-right">
          마지막 수정: {dncConfig.updatedBy || '-'} ({new Date(dncConfig.updatedAt).toLocaleString()})
        </div>
      )}
    </div>
  );
}

// 작업 상태 뱃지
function JobStatusBadge({ status }: { status: SchedulerJob['status'] }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    RUNNING: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    PAUSED: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    COMPLETED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  const labels: Record<string, string> = {
    PENDING: '대기',
    RUNNING: '실행',
    PAUSED: '일시정지',
    COMPLETED: '완료',
    CANCELLED: '취소',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

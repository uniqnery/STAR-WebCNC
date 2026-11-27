// Scheduler Page — SchedulerRow 기반 큐 관리 + 실행 제어

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useMachineStore,
  useMachineTelemetry,
  useFocasEvents,
  useSchedulerRows,
  useSchedulerState,
  useSchedulerError,
  useProgramTransferConfig,
  useControlLock,
  useMachineAlarms,
  SchedulerRow,
  SchedulerState,
  MachineProgramTransferConfig,
  type Alarm,
} from '../stores/machineStore';
import { useTemplateStore, type PmcMessageEntry } from '../stores/templateStore';
import { useAuthStore } from '../stores/authStore';
import { schedulerApi, programTransferApi, fileApi } from '../lib/api';
import { NCMonitor, TABS, type MonitorTab } from '../components/NCMonitor';
import { FocasEventLog } from '../components/FocasEventLog';
import { UserActivityFeed } from '../components/UserActivityFeed';
import { GCodeViewer } from '../components/filemanager/GCodeViewer';
import { ProgramRepositoryModal } from '../components/filemanager/ProgramRepositoryModal';
import { MachineTopBar } from '../components/MachineTopBar';

type ProgramCheck = {
  status: 'exists' | 'missing' | 'unknown' | 'changed' | 'protected';
  comment?: string;
};

type ProgramListEntry = {
  programNo?: string;
  name?: string;
  comment?: string;
  sha256?: string;
  isProtected?: boolean;
};

const normalizeProgramNo = (value?: string | null) => {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits ? `O${digits.padStart(4, '0')}` : '';
};

const buildUnknownChecks = (rows: SchedulerRow[], field: 'mainProgramNo' | 'subProgramNo') => Object.fromEntries(
  rows.filter((row) => row[field]).map((row) => [row.id, { status: 'unknown' as const }]),
);

export function Scheduler() {
  const user = useAuthStore((state) => state.user);
  const {
    selectedMachineId,
    setSchedulerRows,
    setSchedulerState,
    setProgramTransferConfig,
    clearSchedulerError,
  } = useMachineStore();
  const machines = useMachineStore((s) => s.machines);
  const telemetry = useMachineTelemetry(selectedMachineId || '');
  const focasEvents = useFocasEvents(selectedMachineId || '');
  const rows = useSchedulerRows(selectedMachineId || '');
  const schedulerState = useSchedulerState(selectedMachineId || '');
  const schedulerError = useSchedulerError(selectedMachineId || '');
  const programTransferConfig = useProgramTransferConfig(selectedMachineId || '');
  const controlLock = useControlLock(selectedMachineId || '');
  const activeAlarms = useMachineAlarms(selectedMachineId || '');

  const { templates, loadTemplates } = useTemplateStore();
  const selectedTemplate = useTemplateStore(
    (s) => s.templates.find((t) => t.id === s.selectedTemplateId) ?? null,
  );
  useEffect(() => { if (templates.length === 0) loadTemplates(); }, [templates.length, loadTemplates]);

  const pmcBits = telemetry?.pmcBits ?? {};
  const activePmcMessages: PmcMessageEntry[] = (selectedTemplate?.pmcMessages ?? [])
    .filter((m) => m.pmcAddr && pmcBits[m.pmcAddr] === 1);

  const [monitorTab, setMonitorTab] = useState<MonitorTab>('monitor');
  const [mobileTab, setMobileTab] = useState<'monitor' | 'scheduler'>('monitor');
  const [programChecks, setProgramChecks] = useState<Record<string, ProgramCheck>>({});
  const [subProgramChecks, setSubProgramChecks] = useState<Record<string, ProgramCheck>>({});
  const SCHED_TABS_ORDER: ('monitor' | 'scheduler')[] = ['monitor', 'scheduler'];
  const swipeStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => { swipeStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    swipeStartX.current = null;
    if (Math.abs(dx) < 50) return;
    const idx = SCHED_TABS_ORDER.indexOf(mobileTab);
    if (dx < 0 && idx < SCHED_TABS_ORDER.length - 1) setMobileTab(SCHED_TABS_ORDER[idx + 1]);
    if (dx > 0 && idx > 0) setMobileTab(SCHED_TABS_ORDER[idx - 1]);
  };
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const machine = machines.find((m) => m.machineId === selectedMachineId);
  const isAdminOrEngineer = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';
  const hasControlLock = controlLock?.isOwner ?? false;
  const pathCount = machine?.pathCount || 2;

  // ── 큐 로드 ──────────────────────────────────────────────────────────────
  const loadRows = useCallback(async () => {
    if (!selectedMachineId) return;
    try {
      const res = await schedulerApi.getRows(selectedMachineId);
      if (res.success && res.data) {
        const d = res.data as { rows: SchedulerRow[]; state: SchedulerState };
        setSchedulerRows(selectedMachineId, d.rows ?? []);
        if (d.state) setSchedulerState(selectedMachineId, d.state);
      }
    } catch {
      // 서버 미연결 시 localStorage 유지
    }
  }, [selectedMachineId]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // 프로그램 파일전송 설정 로드 — 서버 설정 + localStorage 기본값 병합
  useEffect(() => {
    if (!selectedMachineId) return;
    programTransferApi.getConfig(selectedMachineId).then((res) => {
      if (res.success && res.data) {
        const d = res.data as { machineId: string; programTransferConfig?: { path1?: string; path2?: string; path3?: string; mainMode?: string; subMode?: string; executionMode?: string; mainTempProgramNo?: number; mainParkingProgramNo?: number; subTempProgramNo?: number; subParkingProgramNo?: number }; dncConfig?: { path1?: string; path2?: string; path3?: string; mainMode?: string; subMode?: string; executionMode?: string; mainTempProgramNo?: number; mainParkingProgramNo?: number; subTempProgramNo?: number; subParkingProgramNo?: number } };
        const remoteConfig = d.programTransferConfig ?? d.dncConfig;
        if (remoteConfig) {
          // 하위호환: 서버에 구버전 executionMode만 있으면 mainMode로 사용
          const normalizeMode = (value?: string): 'memory' | 'transfer' => value === 'dnc' || value === 'transfer' ? 'transfer' : 'memory';
          const mainMode = normalizeMode(remoteConfig.mainMode ?? remoteConfig.executionMode);
          // 기존 localStorage의 defaultMainPgm/defaultSubPgm/defaultPreset 보존
          const existing = useMachineStore.getState().programTransferConfigs[selectedMachineId];
          setProgramTransferConfig(selectedMachineId, {
            machineId: selectedMachineId,
            pathCount,
            mainMode,
            subMode: normalizeMode(remoteConfig.subMode),
            repositoryPaths: { path1: '', path2: '' },
            mainTempProgramNo: remoteConfig.mainTempProgramNo ?? 7777,
            mainParkingProgramNo: remoteConfig.mainParkingProgramNo ?? 7776,
            subTempProgramNo: remoteConfig.subTempProgramNo ?? 7775,
            subParkingProgramNo: remoteConfig.subParkingProgramNo ?? 7774,
            defaultMainPgm: existing?.defaultMainPgm,
            defaultSubPgm:  existing?.defaultSubPgm,
            defaultPreset:  existing?.defaultPreset,
          });
        }
      }
    }).catch(() => null);
  }, [selectedMachineId]);

  useEffect(() => {
    if (!selectedMachineId) {
      setProgramChecks({});
      setSubProgramChecks({});
      return;
    }
    const timer = window.setTimeout(() => {
      const mode = programTransferConfig?.mainMode ?? 'memory';
      const load = mode === 'transfer' ? fileApi.listRepoFiles(selectedMachineId, 'path1') : fileApi.listCncFiles(selectedMachineId, 1);
      void load.then((response) => {
        if (!response.success) {
          setProgramChecks(buildUnknownChecks(rows, 'mainProgramNo'));
          return;
        }
        const rawData = response.data as unknown;
        const entries = (mode === 'transfer'
          ? rawData
          : (rawData as { programs?: ProgramListEntry[] })?.programs) as ProgramListEntry[] | undefined;
        const byProgram = new Map((entries ?? []).map((entry) => [normalizeProgramNo(entry.programNo ?? entry.name), entry]));
        setProgramChecks(Object.fromEntries(rows.filter((row) => row.mainProgramNo).map((row) => {
          const program = byProgram.get(normalizeProgramNo(row.mainProgramNo));
          if (!program) return [row.id, { status: 'missing' as const }];
          if (program.isProtected) return [row.id, { status: 'protected' as const, comment: program.comment }];
          if (mode === 'transfer' && row.mainProgramSha256 && program.sha256 && row.mainProgramSha256 !== program.sha256) {
            return [row.id, { status: 'changed' as const, comment: program.comment }];
          }
          return [row.id, { status: 'exists' as const, comment: program.comment }];
        })));
      }).catch(() => setProgramChecks(buildUnknownChecks(rows, 'mainProgramNo')));

      void fileApi.listCncFiles(selectedMachineId, 2).then((response) => {
        if (!response.success) {
          setSubProgramChecks(buildUnknownChecks(rows, 'subProgramNo'));
          return;
        }
        const entries = (response.data as { programs?: ProgramListEntry[] } | undefined)?.programs;
        const byProgram = new Map((entries ?? []).map((entry) => [normalizeProgramNo(entry.programNo ?? entry.name), entry]));
        setSubProgramChecks(Object.fromEntries(rows.filter((row) => row.subProgramNo).map((row) => {
          const program = byProgram.get(normalizeProgramNo(row.subProgramNo));
          if (!program) return [row.id, { status: 'missing' as const }];
          if (program.isProtected) return [row.id, { status: 'protected' as const, comment: program.comment }];
          return [row.id, { status: 'exists' as const, comment: program.comment }];
        })));
      }).catch(() => setSubProgramChecks(buildUnknownChecks(rows, 'subProgramNo')));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [selectedMachineId, programTransferConfig?.mainMode, rows.map((row) => `${row.id}:${row.mainProgramNo}:${row.mainProgramSha256 ?? ''}:${row.subProgramNo ?? ''}`).join('|')]);

  // ── 행 추가 ──────────────────────────────────────────────────────────────
  const handleAddRow = async () => {
    if (!selectedMachineId) return;
    try {
      const mainProgramNo = programTransferConfig?.defaultMainPgm?.trim() || '';
      const subProgramNo  = programTransferConfig?.defaultSubPgm?.trim()  || undefined;
      const preset        = programTransferConfig?.defaultPreset ?? 10;
      const res = await schedulerApi.addRow({
        machineId: selectedMachineId,
        mainProgramNo,
        ...(subProgramNo ? { subProgramNo } : {}),
        preset,
      });
      if (res.success) {
        await loadRows();
      } else {
        setActionError(res.error?.message ?? '행 추가 실패');
      }
    } catch {
      setActionError('행 추가 실패');
    }
  };

  // ── 행 삭제 ──────────────────────────────────────────────────────────────
  const handleDeleteRow = async (rowId: string) => {
    try {
      const res = await schedulerApi.deleteRow(rowId);
      if (res.success) {
        await loadRows();
      } else {
        setActionError(res.error?.message ?? '행 삭제 실패');
      }
    } catch {
      setActionError('행 삭제 실패');
    }
  };

  // ── 행 필드 onBlur 저장 ───────────────────────────────────────────────────
  const handleRowBlur = async (rowId: string, field: keyof SchedulerRow, value: string | number | null) => {
    try {
      const res = await schedulerApi.updateRow(rowId, { [field]: value });
      if (!res.success) {
        setActionError(res.error?.message ?? '수정 실패');
        await loadRows(); // 실패 시 원복
      }
    } catch {
      setActionError('수정 실패');
    }
  };

  const handleResyncProgramRow = async (rowId: string) => {
    const response = await schedulerApi.resyncProgramRow(rowId);
    if (!response.success) setActionError(response.error?.message ?? '프로그램 저장소 재확인 실패');
    await loadRows();
  };

  // ── 실행 제어 ─────────────────────────────────────────────────────────────
  const handleStart = async () => {
    if (!selectedMachineId) return;
    const res = await schedulerApi.start(selectedMachineId);
    if (!res.success) setActionError(res.error?.message ?? '시작 실패');
  };

  const handleResume = async () => {
    if (!selectedMachineId) return;
    const res = await schedulerApi.resume(selectedMachineId);
    if (!res.success) setActionError(res.error?.message ?? '재개 실패');
  };

  const handleStop = async () => {
    if (!selectedMachineId) return;
    const res = await schedulerApi.cancel(selectedMachineId);
    if (!res.success) setActionError(res.error?.message ?? '정지 실패');
    else await loadRows();
  };

  const handleReset = () => {
    if (!selectedMachineId || schedulerState === 'RUNNING') return;
    setConfirmOpen(true);
  };

  const handleConfirmReset = async () => {
    setConfirmOpen(false);
    if (!selectedMachineId) return;
    const res = await schedulerApi.clearAll(selectedMachineId);
    if (res.success) {
      setSchedulerRows(selectedMachineId, []);
      setSchedulerState(selectedMachineId, 'IDLE');
    } else {
      setActionError(res.error?.message ?? '초기화 실패');
    }
  };

  // cnc_statinfo().run 기반 가동 중 여부 (2=START, 3=MSTR)
  const isMachineRunning = (telemetry?.runState ?? 0) >= 2 && (telemetry?.runState ?? 0) <= 3;

  // 현재 실행 중인 행: schedulerState=RUNNING 일 때 첫 번째 미완료 행
  // (DB에 RUNNING status를 쓰는 경로가 없으므로 위치로 추론)
  const currentRow = schedulerState === 'RUNNING'
    ? rows.find((r) => r.status !== 'COMPLETED')
    : undefined;

  // COUNT >= PRESET 팝업 대상 행
  const countExceedsRow =
    schedulerError?.code === 'COUNT_EXCEEDS_PRESET' && schedulerError.rowId
      ? rows.find((r) => r.id === schedulerError.rowId)
      : null;

  // 프로그램 파일전송 설정
  const programTransferSettingsContent = (
    <ProgramTransferSettingsContent
      programTransferConfig={programTransferConfig}
      isAdmin={isAdminOrEngineer}
      isSchedulerRunning={schedulerState === 'RUNNING'}
      onSave={(settings, defaults) => {
        if (!selectedMachineId) return;
        const config: MachineProgramTransferConfig = {
          machineId: selectedMachineId,
          pathCount,
          ...settings,
          repositoryPaths: { path1: '', path2: '' },
          defaultMainPgm: defaults.mainPgm || undefined,
          defaultSubPgm:  defaults.subPgm  || undefined,
          defaultPreset:  defaults.preset  ?? undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: user?.username,
        };
        setProgramTransferConfig(selectedMachineId, config);
        // 기본값은 localStorage만 저장하고 실행 모드는 서버에도 저장한다.
        programTransferApi.saveConfig(selectedMachineId, {
          path1: '',
          path2: '',
          ...settings,
        }).catch(() => null);
      }}
    />
  );

  return (
    <div
      className="p-6 lg:p-4 space-y-4 lg:space-y-0 lg:gap-3 lg:h-full lg:flex lg:flex-col lg:overflow-hidden max-lg:landscape:p-1 max-lg:landscape:space-y-1 max-lg:landscape:pl-7 max-lg:portrait:overflow-x-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="lg:shrink-0">
        <MachineTopBar
          pageTitle="스케줄러"
          pageId="scheduler"
          settingsContent={programTransferSettingsContent}
          settingsAdjacentContent={
            <button
              onClick={() => setUploadOpen(true)}
              disabled={!selectedMachineId}
              className="hidden lg:inline-flex p-2 rounded-lg text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              title="프로그램 저장소"
            >
              <UploadFileIcon className="w-5 h-5" />
            </button>
          }
        />
      </div>

      {/* 큐 초기화 확인 모달 */}
      {confirmOpen && (
        <ConfirmModal
          title="큐 전체 초기화"
          message={`큐의 모든 행(${rows.length}개)을 삭제합니다.\n이 작업은 되돌릴 수 없습니다.`}
          confirmLabel="전체 삭제"
          confirmClass="bg-red-600 hover:bg-red-700"
          onConfirm={handleConfirmReset}
          onCancel={() => setConfirmOpen(false)}
        />
      )}

      {/* COUNT >= PRESET 팝업 모달 */}
      {countExceedsRow && (
        <CountExceedsPresetModal
          row={countExceedsRow}
          message={schedulerError!.message}
          onResume={async () => {
            if (selectedMachineId) clearSchedulerError(selectedMachineId);
            await handleResume();
          }}
          onClose={() => { if (selectedMachineId) clearSchedulerError(selectedMachineId); }}
          onUpdateRow={handleRowBlur}
        />
      )}

      {/* API 액션 에러 (서버 통신 오류 등) — 스케줄러 상태 에러는 이벤트 로그에 표시 */}
      {actionError && (
        <div className="px-3 py-2 bg-red-900/50 text-red-300 rounded-lg border border-red-700/60 flex justify-between items-center text-sm">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-200 ml-4">✕</button>
        </div>
      )}

      {selectedMachineId && <ProgramRepositoryModal machineId={selectedMachineId} open={uploadOpen} canEdit={isAdminOrEngineer} isTransferRunning={schedulerState === 'RUNNING' && (programTransferConfig?.mainMode ?? 'memory') === 'transfer'} isTransferMode={(programTransferConfig?.mainMode ?? 'memory') === 'transfer'} defaultSubProgramNo={programTransferConfig?.defaultSubPgm} defaultPreset={programTransferConfig?.defaultPreset ?? 10} onSchedulerRegistered={() => { void loadRows(); }} onClose={() => setUploadOpen(false)} />}

      {selectedMachineId && (
        <>
          {/* 모바일 portrait 탭 바 — PC(lg:) 및 landscape에서 숨김 */}
          <div className="hidden max-lg:portrait:flex rounded-lg overflow-hidden border border-gray-700">
            {(['monitor', 'scheduler'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setMobileTab(t)}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  mobileTab === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                {t === 'monitor' ? '모니터' : '스케줄러'}
              </button>
            ))}
          </div>

          {/* PC: lg:grid-cols-2 / 모바일 landscape: grid-cols-2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 max-lg:landscape:grid-cols-2 gap-4 lg:flex-[4_1_0%] lg:min-h-0 max-lg:portrait:w-full max-lg:portrait:max-w-full max-lg:portrait:min-w-0 max-lg:portrait:overflow-x-hidden">
            {/* 좌측: NC 모니터 + 알람 + 탭 바 */}
            <div className={`flex flex-col gap-2 max-lg:portrait:gap-1 overflow-hidden max-lg:portrait:w-full max-lg:portrait:max-w-full max-lg:portrait:min-w-0 lg:h-full max-lg:portrait:h-auto max-lg:landscape:h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] lg:flex max-lg:landscape:flex ${mobileTab === 'monitor' ? 'max-lg:portrait:flex' : 'max-lg:portrait:hidden'}`}>
              <div className="flex-1 min-h-0 max-lg:portrait:flex-none lg:flex-none lg:shrink-0">
                <NCMonitor
                  path1={telemetry?.path1}
                  path2={telemetry?.path2}
                  machineMode={telemetry?.mode ? `PROGRAM( ${telemetry.mode} )` : undefined}
                  mode={telemetry?.mode}
                  machineId={selectedMachineId || undefined}
                  activeTab={monitorTab}
                  onTabChange={setMonitorTab}
                  hideTabs
                />
              </div>
              <div className="shrink-0 h-24 lg:h-auto lg:flex-1 lg:min-h-0"><AlarmStrip alarms={activeAlarms} pmcMessages={activePmcMessages} /></div>
              <div className="shrink-0 flex rounded-lg overflow-hidden border border-gray-700">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setMonitorTab(tab.id)}
                    className={`flex-1 py-2 text-xs font-medium transition-colors ${
                      monitorTab === tab.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {/* 모바일 portrait 전용 로그 — PC(lg:) 및 landscape에서 숨김 */}
              <div className="lg:hidden landscape:hidden shrink-0 h-40 max-lg:portrait:mt-0">
                <FocasEventLog events={focasEvents} userActivityContent={<UserActivityFeed machineId={selectedMachineId || ''} page="scheduler" />} />
              </div>
            </div>

            {/* 우측: 스케줄러 */}
            <div className={`flex flex-col gap-2 max-lg:portrait:w-full max-lg:portrait:max-w-full max-lg:portrait:min-w-0 lg:h-full max-lg:portrait:h-auto max-lg:landscape:h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] lg:flex max-lg:landscape:flex ${mobileTab === 'scheduler' ? 'max-lg:portrait:flex' : 'max-lg:portrait:hidden'}`}>
            <div className="bg-gray-800 text-white rounded-lg shadow p-4 flex flex-col lg:flex-1 lg:min-h-0 max-lg:landscape:flex-1 max-lg:landscape:min-h-0 max-lg:portrait:flex-none">

              {/* 현재 실행 상태 + 제어 버튼 (같은 줄, 우측 정렬) */}
              <div className="mb-3 p-3 bg-gray-700 rounded-lg flex items-center gap-2">
                {/* 상태 배지 */}
                <SchedulerStateBadge state={schedulerState} />

                {/* 현재 행 정보 */}
                <span className="font-mono text-sm text-white">
                  {currentRow
                    ? `${currentRow.mainProgramNo}${currentRow.subProgramNo ? ` / ${currentRow.subProgramNo}` : ''}`
                    : <span className="text-gray-500 text-xs">대기 중</span>}
                </span>
                {currentRow && (
                  <span className="text-cyan-300 font-mono text-sm shrink-0">
                    {currentRow.count} / {currentRow.preset}
                  </span>
                )}

                {/* 구분선 */}
                <div className="flex-1 h-px bg-gray-600 mx-1" />

                {/* 실행 모드 표시 */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-gray-400">메인</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                    (programTransferConfig?.mainMode ?? 'memory') === 'transfer'
                      ? 'bg-purple-700/60 text-purple-200'
                      : 'bg-gray-600 text-gray-300'
                  }`}>
                    {(programTransferConfig?.mainMode ?? 'memory') === 'transfer' ? '전송' : '저장'}
                  </span>
                  {pathCount >= 2 && <>
                    <span className="text-[10px] text-gray-400 ml-1">서브</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${(programTransferConfig?.subMode ?? 'memory') === 'transfer' ? 'bg-purple-700/60 text-purple-200' : 'bg-gray-600 text-gray-300'}`}>
                      {(programTransferConfig?.subMode ?? 'memory') === 'transfer' ? '전송' : '저장'}
                    </span>
                  </>}
                </div>

                {/* 구분선 */}
                <div className="h-4 w-px bg-gray-600 mx-1" />

                {/* 시작/정지 버튼 */}
                <div className="flex gap-2 shrink-0">
                  {schedulerState === 'IDLE' || schedulerState === 'ERROR' ? (
                    <button
                      onClick={handleStart}
                      disabled={!hasControlLock || rows.filter((r) => r.status !== 'RUNNING' && r.status !== 'COMPLETED').length === 0}
                      className="px-4 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-35 disabled:cursor-not-allowed"
                    >
                      ▶ 시작
                    </button>
                  ) : schedulerState === 'PAUSED' ? (
                    <>
                      <button
                        onClick={handleStart}
                        disabled={!hasControlLock || rows.filter((r) => r.status !== 'RUNNING' && r.status !== 'COMPLETED').length === 0}
                        className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        ▶ 시작
                      </button>
                      <button
                        onClick={handleResume}
                        disabled={!hasControlLock}
                        className="px-4 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        ↺ 재개
                      </button>
                    </>
                  ) : null}
                  <button
                    onClick={handleStop}
                    disabled={!hasControlLock || schedulerState === 'IDLE'}
                    className="px-4 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    ■ 정지
                  </button>
                </div>
              </div>

              {/* 큐 테이블 */}
              <div className="overflow-auto flex-1 min-h-0 max-lg:portrait:flex-none max-lg:portrait:min-h-[23rem] max-lg:portrait:overflow-visible">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col className="w-8" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col className="w-16" />
                    <col className="w-12" />
                    <col className="w-[72px]" />
                    <col className="w-8" />
                  </colgroup>
                  <thead className="bg-gray-700 sticky top-0">
                    <tr className="text-gray-300 text-xs">
                      <th className="px-1 py-2 text-center">No</th>
                      <th className="px-2 py-2 text-left">메인PGM</th>
                      <th className="px-2 py-2 text-left">서브PGM</th>
                      <th className="px-1 py-2 text-center">PRESET</th>
                      <th className="px-1 py-2 text-center">COUNT</th>
                      <th className="px-1 py-2 text-center">상태</th>
                      <th className="px-1 py-2 text-center">✕</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-600">
                    {rows.map((row, idx) => (
                      <SchedulerRowItem
                        key={row.id}
                        row={row}
                        index={idx}
                        isCurrentRow={currentRow?.id === row.id}
                        isMachineRunning={isMachineRunning}
                        canEdit={isAdminOrEngineer && currentRow?.id !== row.id && row.status !== 'COMPLETED'}
                        programCheck={programChecks[row.id]}
                        subProgramCheck={subProgramChecks[row.id]}
                        onResync={() => { void handleResyncProgramRow(row.id); }}
                        onDelete={() => handleDeleteRow(row.id)}
                        onBlur={handleRowBlur}
                      />
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-gray-500 text-sm">
                          큐가 비어있습니다. 행을 추가하세요.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* 행 추가 / 초기화 */}
              <div className="mt-3 flex gap-2 shrink-0">
                <button
                  onClick={handleAddRow}
                  disabled={!isAdminOrEngineer}
                  className="flex-1 py-2 border-2 border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors disabled:opacity-35 disabled:cursor-not-allowed text-sm"
                >
                  + 행 추가
                </button>
                <button
                  onClick={handleReset}
                  disabled={!isAdminOrEngineer || schedulerState === 'RUNNING'}
                  className="px-4 py-2 border border-gray-600 rounded-lg text-gray-400 hover:border-red-500 hover:text-red-400 transition-colors disabled:opacity-35 disabled:cursor-not-allowed text-sm"
                >
                  초기화
                </button>
              </div>
            </div>

              {/* 모바일 portrait 전용 로그 — PC(lg:) 및 landscape에서 숨김 */}
              <div className="lg:hidden landscape:hidden shrink-0 h-40 max-lg:portrait:mt-0">
                <FocasEventLog events={focasEvents} userActivityContent={<UserActivityFeed machineId={selectedMachineId || ''} page="scheduler" />} />
              </div>
            </div>
          </div>

          {/* 이벤트 로그 — PC/landscape: 나머지 공간 채움(최소 5rem), 모바일 portrait: 숨김 */}
          <div className="max-lg:portrait:hidden max-lg:landscape:flex-1 max-lg:landscape:min-h-[4rem] max-lg:landscape:overflow-hidden lg:flex-1 lg:min-h-[4rem] lg:overflow-hidden">
            <FocasEventLog events={focasEvents} userActivityContent={<UserActivityFeed machineId={selectedMachineId || ''} page="scheduler" />} />
          </div>
          <GCodeViewer />
        </>
      )}
    </div>
  );
}

// ── 행 컴포넌트 ──────────────────────────────────────────────────────────────

function SchedulerRowItem({
  row,
  index,
  isCurrentRow,
  isMachineRunning,
  canEdit,
  programCheck,
  subProgramCheck,
  onResync,
  onDelete,
  onBlur,
}: {
  row: SchedulerRow;
  index: number;
  isCurrentRow: boolean;
  isMachineRunning: boolean;
  canEdit: boolean;
  programCheck?: ProgramCheck;
  subProgramCheck?: ProgramCheck;
  onResync: () => void;
  onDelete: () => void;
  onBlur: (rowId: string, field: keyof SchedulerRow, value: string | number | null) => void;
}) {
  const [mainPgm, setMainPgm] = useState((row.mainProgramNo ?? '').replace(/^O/i, ''));
  const [subPgm, setSubPgm] = useState((row.subProgramNo ?? '').replace(/^O/i, ''));
  const [preset, setPreset] = useState(String(row.preset));

  // 포커스 중 WS 동기화 차단 — onBlur 후에만 서버값 반영
  const isEditingRef = useRef(false);

  // row 변경 시 로컬 state 동기화 (편집 중이면 건너뜀)
  useEffect(() => { if (!isEditingRef.current) setMainPgm((row.mainProgramNo ?? '').replace(/^O/i, '')); }, [row.mainProgramNo]);
  useEffect(() => { if (!isEditingRef.current) setSubPgm((row.subProgramNo ?? '').replace(/^O/i, '')); }, [row.subProgramNo]);
  useEffect(() => { if (!isEditingRef.current) setPreset(String(row.preset)); }, [row.preset]);

  const hasError = row.status === 'PENDING' && !!row.lastError;

  return (
    <tr className={`
      ${isCurrentRow ? 'bg-green-900/20' : ''}
      ${hasError ? 'bg-orange-900/20' : ''}
    `}>
      <td className="px-1 py-1.5 text-center text-gray-400 font-mono text-xs">{index + 1}</td>

      {/* 메인 PGM */}
      <td className="px-1 py-1.5">
        <div className="flex items-center" title={programCheck?.comment ?? row.mainProgramComment ?? ''}>
          <span className="font-mono text-xs text-gray-400 mr-0.5">O</span>
          <input
            type="text"
            value={mainPgm}
            onChange={(e) => setMainPgm(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onFocus={() => { isEditingRef.current = true; }}
            onBlur={() => {
              const normalized = mainPgm ? mainPgm.padStart(4, '0') : '';
              setMainPgm(normalized);
              isEditingRef.current = false;
              onBlur(row.id, 'mainProgramNo', normalized ? `O${normalized}` : '');
            }}
            disabled={!canEdit}
            className="w-[52px] px-1 py-0.5 border border-gray-600 rounded font-mono text-xs bg-gray-700 text-white disabled:opacity-50 focus:border-blue-500 focus:outline-none"
            placeholder="0001"
          />
          {mainPgm && <span className={`ml-1 text-[10px] ${programCheck?.status === 'exists' ? 'text-green-400' : programCheck?.status === 'missing' ? 'text-red-400' : programCheck?.status === 'changed' ? 'text-orange-400' : programCheck?.status === 'protected' ? 'text-yellow-400' : 'text-gray-400'}`} title={programCheck?.status === 'exists' ? '프로그램 확인됨' : programCheck?.status === 'missing' ? '프로그램 없음' : programCheck?.status === 'changed' ? '등록 이후 프로그램 변경됨' : programCheck?.status === 'protected' ? '파라미터 3202#4(NE9) 보호 프로그램' : '프로그램 확인 불가'}>{programCheck?.status === 'exists' ? '●' : programCheck?.status === 'missing' ? '●' : programCheck?.status === 'changed' ? '!' : programCheck?.status === 'protected' ? '🔒' : '?'}</span>}
          {programCheck?.status === 'changed' && <button type="button" onClick={onResync} disabled={!canEdit} title="현재 저장소 파일로 재확인" className="ml-1 text-[10px] text-blue-400 disabled:opacity-30">↻</button>}
        </div>
        <input key={`${row.id}:${row.productionComment}`} aria-label="스케줄러 생산 코멘트" defaultValue={row.productionComment ?? ''}
          maxLength={500} disabled={!canEdit} onBlur={e => onBlur(row.id, 'productionComment', e.target.value.trim())}
          placeholder="생산 코멘트 (선택)" className="mt-1 w-full min-w-24 px-1 py-0.5 text-xs bg-gray-700 text-white rounded disabled:opacity-50" />
      </td>

      {/* 서브 PGM */}
      <td className="px-1 py-1.5">
        <div className="flex items-center" title={subProgramCheck?.comment ?? ''}>
          <span className="font-mono text-xs text-gray-400 mr-0.5">O</span>
          <input
            type="text"
            value={subPgm}
            onChange={(e) => setSubPgm(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onFocus={() => { isEditingRef.current = true; }}
            onBlur={() => {
              const normalized = subPgm ? subPgm.padStart(4, '0') : '';
              setSubPgm(normalized);
              isEditingRef.current = false;
              onBlur(row.id, 'subProgramNo', normalized ? `O${normalized}` : null);
            }}
            disabled={!canEdit}
            className="w-[52px] px-1 py-0.5 border border-gray-600 rounded font-mono text-xs bg-gray-700 text-white disabled:opacity-50 focus:border-blue-500 focus:outline-none"
            placeholder="0001"
          />
          {subPgm && <span className={`ml-1 text-[10px] ${subProgramCheck?.status === 'exists' ? 'text-green-400' : subProgramCheck?.status === 'missing' ? 'text-red-400' : subProgramCheck?.status === 'protected' ? 'text-yellow-400' : 'text-gray-400'}`} title={subProgramCheck?.status === 'exists' ? '프로그램 확인됨' : subProgramCheck?.status === 'missing' ? '프로그램 없음' : subProgramCheck?.status === 'protected' ? '파라미터 3202#4(NE9) 보호 프로그램' : '프로그램 확인 불가'}>{subProgramCheck?.status === 'exists' ? '●' : subProgramCheck?.status === 'missing' ? '●' : subProgramCheck?.status === 'protected' ? '🔒' : '?'}</span>}
        </div>
      </td>

      {/* PRESET */}
      <td className="px-1 py-1.5 text-center">
        <input
          type="number"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          onFocus={() => { isEditingRef.current = true; }}
          onBlur={() => { isEditingRef.current = false; onBlur(row.id, 'preset', parseInt(preset) || 1); }}
          disabled={!canEdit}
          min={1}
          className="w-[52px] px-1 py-0.5 border border-gray-600 rounded text-xs text-center bg-gray-700 text-white disabled:opacity-50 focus:border-blue-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </td>

      {/* COUNT */}
      <td className="px-1 py-1.5 text-center font-mono text-xs">
        <span className={isCurrentRow ? 'text-cyan-300' : 'text-white'}>
          {row.count}
        </span>
      </td>

      {/* 상태 */}
      <td className="px-1 py-1.5 text-center">
        {hasError ? (
          <span title={`이전 실행 오류: ${row.lastError}`} className="cursor-help">
            <RowStatusBadge status={row.status} hasError />
          </span>
        ) : (
          <RowStatusBadge status={row.status} isCurrentRow={isCurrentRow} isMachineRunning={isMachineRunning} />
        )}
      </td>

      {/* 삭제 */}
      <td className="px-1 py-1.5 text-center">
        <button
          onClick={onDelete}
          disabled={row.status === 'RUNNING'}
          className="text-red-400 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed text-xs"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

// ── 상태 배지 ─────────────────────────────────────────────────────────────────

function SchedulerStateBadge({ state }: { state: SchedulerState }) {
  const map: Record<SchedulerState, { label: string; cls: string }> = {
    IDLE: { label: 'IDLE', cls: 'bg-gray-600 text-gray-300' },
    RUNNING: { label: 'RUNNING', cls: 'bg-green-700 text-green-200' },
    PAUSED: { label: 'PAUSED', cls: 'bg-yellow-700 text-yellow-200' },
    ERROR: { label: 'ERROR', cls: 'bg-red-700 text-red-200' },
  };
  const { label, cls } = map[state] ?? map.IDLE;
  return <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${cls}`}>{label}</span>;
}

function RowStatusBadge({ status, hasError, isCurrentRow, isMachineRunning }: {
  status: SchedulerRow['status'];
  hasError?: boolean;
  isCurrentRow?: boolean;
  isMachineRunning?: boolean;
}) {
  if (isCurrentRow) {
    // 스케줄러가 이 행을 처리 중 → 가동
    // isMachineRunning(cnc_statinfo run=2|3): 실제 절삭 중이면 펄스, 사이클 간 준비 구간이면 고정
    // Path2Only 구간은 Path1 정지로 runState=0이지만 서브가 가동 중이므로 항상 가동 표시
    return (
      <span className={`px-1.5 py-0.5 rounded text-xs font-medium bg-green-900/40 text-green-400 ${isMachineRunning ? 'animate-pulse' : ''}`}>가동</span>
    );
  }
  if (status === 'COMPLETED') return (
    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-900/40 text-blue-400">완료</span>
  );
  // PENDING (기본)
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${hasError ? 'bg-orange-900/40 text-orange-400' : 'bg-gray-700 text-gray-300'}`}>
      {hasError ? '⚠ 대기' : '대기'}
    </span>
  );
}

// ── COUNT >= PRESET 모달 ──────────────────────────────────────────────────────

// ── 알람 / PMC 메시지 표시 ────────────────────────────────────────────────────

function AlarmStrip({ alarms, pmcMessages = [] }: { alarms: Alarm[]; pmcMessages?: PmcMessageEntry[] }) {
  const hasAlarms = alarms.length > 0;
  const hasMsgs   = pmcMessages.length > 0;
  const hasAny    = hasAlarms || hasMsgs;

  return (
    <div className={`h-full rounded-lg border px-3 py-2 flex flex-col gap-1 overflow-y-auto transition-colors ${
      hasAlarms ? 'bg-red-950/40 border-red-700/60' : hasMsgs ? 'bg-yellow-950/30 border-yellow-700/50' : 'bg-gray-900 border-gray-700'
    }`}>
      {hasAny ? (
        <>
          {alarms.map((a) => (
            <div key={a.id} className="flex items-start gap-2 min-w-0 shrink-0">
              <span className="shrink-0 text-[10px] font-bold text-red-400 leading-4 tabular-nums">
                {a.category ? `${a.category}` : 'ALM'} {a.alarmNo}
              </span>
              <span className="flex-1 text-[11px] text-red-200 leading-4 truncate">{a.alarmMsg}</span>
              <span className="shrink-0 text-[10px] text-red-500/70 leading-4 tabular-nums">
                {new Date(a.occurredAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))}
          {pmcMessages.map((m) => (
            <div key={m.id} className="flex items-start gap-2 min-w-0 shrink-0">
              <span className="shrink-0 text-[10px] font-bold text-yellow-500 leading-4">MSG</span>
              <span className="flex-1 text-[11px] text-yellow-200 leading-4 truncate">{m.message}</span>
            </div>
          ))}
        </>
      ) : (
        <span className="text-[11px] text-gray-600 m-auto">알람 없음</span>
      )}
    </div>
  );
}

// ── 공용 확인 모달 ─────────────────────────────────────────────────────────────

function ConfirmModal({
  title,
  message,
  confirmLabel = '확인',
  confirmClass = 'bg-blue-600 hover:bg-blue-700',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 배경 오버레이 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      {/* 모달 */}
      <div className="relative bg-gray-800 border border-gray-600 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-700">
          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-white">{title}</h3>
        </div>
        {/* 내용 */}
        <div className="px-5 py-4">
          <p className="text-sm text-gray-300 whitespace-pre-line leading-relaxed">{message}</p>
        </div>
        {/* 버튼 */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2 text-sm font-medium rounded-lg text-white transition-colors ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CountExceedsPresetModal({
  row,
  message,
  onResume,
  onClose,
  onUpdateRow,
}: {
  row: SchedulerRow;
  message: string;
  onResume: () => void;
  onClose: () => void;
  onUpdateRow: (rowId: string, field: keyof SchedulerRow, value: string | number | null) => Promise<void>;
}) {
  const [preset, setPreset] = useState(String(row.preset));
  const [count, setCount] = useState(String(row.count));
  const [saving, setSaving] = useState(false);

  const handleResumeClick = async () => {
    setSaving(true);
    // preset 또는 count가 변경됐으면 먼저 저장
    const newPreset = parseInt(preset) || row.preset;
    const newCount = parseInt(count);
    if (newPreset !== row.preset) await onUpdateRow(row.id, 'preset', newPreset);
    if (!isNaN(newCount) && newCount !== row.count) await onUpdateRow(row.id, 'count', newCount);
    setSaving(false);
    onResume();
  };

  const currentPreset = parseInt(preset) || row.preset;
  const currentCount = parseInt(count);
  const isValid = !isNaN(currentCount) && currentCount < currentPreset;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 border border-red-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-700">
          <span className="text-red-400 text-xl">⚠</span>
          <div>
            <div className="font-bold text-white text-sm">COUNT ≥ PRESET 오류</div>
            <div className="text-xs text-gray-400 mt-0.5">스케줄러가 일시 정지되었습니다.</div>
          </div>
        </div>

        {/* 내용 */}
        <div className="px-5 py-4 space-y-4">
          {/* 에러 메시지 */}
          <div className="text-sm text-red-300 bg-red-900/30 rounded-lg px-3 py-2 font-mono">
            {message}
          </div>

          {/* 대상 행 정보 */}
          <div className="text-xs text-gray-400 mb-1">
            프로그램: <span className="font-mono text-white">{row.mainProgramNo}</span>
            {row.subProgramNo && (
              <> / <span className="font-mono text-white">{row.subProgramNo}</span></>
            )}
          </div>

          {/* PRESET / COUNT 편집 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">PRESET (목표수량)</label>
              <input
                type="number"
                value={preset}
                min={1}
                onChange={(e) => setPreset(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-500 rounded text-white font-mono text-sm
                           focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">COUNT (현재수량)</label>
              <input
                type="number"
                value={count}
                min={0}
                onChange={(e) => setCount(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-500 rounded text-white font-mono text-sm
                           focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 유효성 안내 */}
          {!isValid && (
            <p className="text-xs text-red-400">
              COUNT는 PRESET보다 작아야 합니다. (COUNT &lt; PRESET)
            </p>
          )}
          {isValid && (
            <p className="text-xs text-green-400">
              COUNT({currentCount}) &lt; PRESET({currentPreset}) — 재개 가능합니다.
            </p>
          )}
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-700">
          <button
            onClick={handleResumeClick}
            disabled={!isValid || saving}
            className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed
                       text-white text-sm rounded-lg font-medium transition-colors"
          >
            {saving ? '저장 중...' : '▶ 수정 후 재개'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-600 text-gray-300 hover:text-white hover:border-gray-400
                       text-sm rounded-lg transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 프로그램 파일전송 설정 ───────────────────────────────────────────────────

function ModeToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: 'memory' | 'transfer';
  onChange: (v: 'memory' | 'transfer') => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-20 flex-shrink-0 font-medium">{label}</span>
      <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
        {(['memory', 'transfer'] as const).map((m) => (
          <button
            key={m}
            disabled={disabled}
            onClick={() => onChange(m)}
            className={`px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed
              ${value === m
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
          >
            {m === 'memory' ? 'CNC 저장' : '파일전송'}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProgramTransferSettingsContent({
  programTransferConfig,
  isAdmin,
  isSchedulerRunning,
  onSave,
}: {
  programTransferConfig?: MachineProgramTransferConfig;
  isAdmin: boolean;
  isSchedulerRunning: boolean;
  onSave: (settings: Pick<MachineProgramTransferConfig, 'mainMode' | 'subMode' | 'mainTempProgramNo' | 'mainParkingProgramNo' | 'subTempProgramNo' | 'subParkingProgramNo'>, defaults: { mainPgm: string; subPgm: string; preset: number | null }) => void;
}) {
  const [mainMode, setMainMode] = useState<'memory' | 'transfer'>(programTransferConfig?.mainMode ?? 'memory');
  const [subMode, setSubMode] = useState<'memory' | 'transfer'>(programTransferConfig?.subMode ?? 'memory');
  const [mainTempProgramNo, setMainTempProgramNo] = useState(String(programTransferConfig?.mainTempProgramNo ?? 7777));
  const [mainParkingProgramNo, setMainParkingProgramNo] = useState(String(programTransferConfig?.mainParkingProgramNo ?? 7776));
  const [subTempProgramNo, setSubTempProgramNo] = useState(String(programTransferConfig?.subTempProgramNo ?? 7775));
  const [subParkingProgramNo, setSubParkingProgramNo] = useState(String(programTransferConfig?.subParkingProgramNo ?? 7774));
  const [defMainPgm, setDefMainPgm] = useState(programTransferConfig?.defaultMainPgm?.replace(/^O/i, '') ?? '');
  const [defSubPgm,  setDefSubPgm]  = useState(programTransferConfig?.defaultSubPgm?.replace(/^O/i, '')  ?? '');
  const [defPreset,  setDefPreset]  = useState(programTransferConfig?.defaultPreset != null ? String(programTransferConfig.defaultPreset) : '');
  const canEdit = isAdmin && !isSchedulerRunning;
  const transferNumbers = [mainTempProgramNo, mainParkingProgramNo, subTempProgramNo, subParkingProgramNo].map(Number);
  const transferNumbersValid = transferNumbers.every((value) => Number.isInteger(value) && value >= 1 && value <= 7999)
    && Number(mainTempProgramNo) !== Number(mainParkingProgramNo)
    && Number(subTempProgramNo) !== Number(subParkingProgramNo);

  useEffect(() => {
    setMainMode(programTransferConfig?.mainMode ?? 'memory');
    setSubMode(programTransferConfig?.subMode ?? 'memory');
    setMainTempProgramNo(String(programTransferConfig?.mainTempProgramNo ?? 7777));
    setMainParkingProgramNo(String(programTransferConfig?.mainParkingProgramNo ?? 7776));
    setSubTempProgramNo(String(programTransferConfig?.subTempProgramNo ?? 7775));
    setSubParkingProgramNo(String(programTransferConfig?.subParkingProgramNo ?? 7774));
    setDefMainPgm(programTransferConfig?.defaultMainPgm?.replace(/^O/i, '') ?? '');
    setDefSubPgm(programTransferConfig?.defaultSubPgm?.replace(/^O/i, '') ?? '');
    setDefPreset(programTransferConfig?.defaultPreset != null ? String(programTransferConfig.defaultPreset) : '');
  }, [programTransferConfig]);

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-gray-900 dark:text-white">프로그램 실행 설정</div>

      {isSchedulerRunning && isAdmin && (
        <div className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 rounded">
          스케줄러 실행 중에는 설정을 변경할 수 없습니다
        </div>
      )}
      {!isAdmin && (
        <div className="text-xs text-gray-500 px-1">관리자만 설정을 변경할 수 있습니다 (읽기 전용)</div>
      )}

      {/* 실행 모드 선택 */}
      <div className="space-y-2">
        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">실행 모드</div>
        <ModeToggle label="메인 (Path1)" value={mainMode} onChange={setMainMode} disabled={!canEdit} />
        <ModeToggle label="서브 (Path2)" value={subMode} onChange={setSubMode} disabled={!canEdit} />
      </div>

      {(mainMode === 'transfer' || subMode === 'transfer') && (
        <div className="space-y-2 pt-1 border-t border-gray-200 dark:border-gray-600">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium pt-1">파일전송 임시 프로그램</div>
          {[
            ['메인 임시', mainTempProgramNo, setMainTempProgramNo],
            ['메인 대피', mainParkingProgramNo, setMainParkingProgramNo],
            ['서브 임시', subTempProgramNo, setSubTempProgramNo],
            ['서브 대피', subParkingProgramNo, setSubParkingProgramNo],
          ].map(([label, value, setter]) => (
            <div key={label as string} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">{label as string}</span>
              <span className="font-mono text-xs text-gray-400">O</span>
              <input type="text" value={value as string} onChange={(e) => (setter as React.Dispatch<React.SetStateAction<string>>)(e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={!canEdit} className="w-16 px-2 py-1 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:opacity-50" />
            </div>
          ))}
          <p className="text-[10px] text-gray-400">대피 프로그램은 임시 프로그램 삭제 전에 CNC에서 선택할 기존 프로그램입니다.</p>
          {!transferNumbersValid && <p className="text-[10px] text-red-500">임시·대피 번호는 Path별로 서로 다른 O0001~O7999여야 합니다.</p>}
        </div>
      )}

      {/* 행 추가 기본값 설정 */}
      <div className="space-y-2 pt-1 border-t border-gray-200 dark:border-gray-600">
        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium pt-1">행 추가 기본값</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">메인 PGM</span>
          <div className="flex items-center gap-0.5">
            <span className="font-mono text-xs text-gray-400">O</span>
            <input
              type="text"
              value={defMainPgm}
              onChange={(e) => setDefMainPgm(e.target.value.replace(/\D/g, '').slice(0, 4))}
              disabled={!canEdit}
              placeholder="0001"
              className="w-16 px-2 py-1 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">서브 PGM</span>
          <div className="flex items-center gap-0.5">
            <span className="font-mono text-xs text-gray-400">O</span>
            <input
              type="text"
              value={defSubPgm}
              onChange={(e) => setDefSubPgm(e.target.value.replace(/\D/g, '').slice(0, 4))}
              disabled={!canEdit}
              placeholder="0001"
              className="w-16 px-2 py-1 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">PRESET</span>
          <input
            type="number"
            value={defPreset}
            onChange={(e) => setDefPreset(e.target.value)}
            disabled={!canEdit}
            min={1}
            placeholder="10"
            className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[10px] text-gray-400">(미입력 시 10)</span>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={() => onSave({ mainMode, subMode, mainTempProgramNo: Number(mainTempProgramNo), mainParkingProgramNo: Number(mainParkingProgramNo), subTempProgramNo: Number(subTempProgramNo), subParkingProgramNo: Number(subParkingProgramNo) }, { mainPgm: defMainPgm ? `O${defMainPgm}` : '', subPgm: defSubPgm ? `O${defSubPgm}` : '', preset: defPreset ? parseInt(defPreset) : null })}
          disabled={!canEdit || !transferNumbersValid}
          className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          저장
        </button>
      </div>

      {programTransferConfig?.updatedAt && (
        <div className="text-xs text-gray-400 text-right">
          마지막 수정: {programTransferConfig.updatedBy || '-'} ({new Date(programTransferConfig.updatedAt).toLocaleString()})
        </div>
      )}
    </div>
  );
}

function UploadFileIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" /></svg>;
}

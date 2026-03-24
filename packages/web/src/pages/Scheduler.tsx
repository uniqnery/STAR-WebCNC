// Scheduler Page — SchedulerRow 기반 큐 관리 + 실행 제어

import { useState, useEffect, useCallback } from 'react';
import {
  useMachineStore,
  useMachineTelemetry,
  useFocasEvents,
  useSchedulerRows,
  useSchedulerState,
  useSchedulerError,
  useDncConfig,
  useControlLock,
  useMachineAlarms,
  SchedulerRow,
  SchedulerState,
  MachineDncConfig,
  DncPathConfig,
  type Alarm,
} from '../stores/machineStore';
import { useTemplateStore, type PmcMessageEntry } from '../stores/templateStore';
import { useAuthStore } from '../stores/authStore';
import { schedulerApi, dncApi } from '../lib/api';
import { NCMonitor, TABS, type MonitorTab } from '../components/NCMonitor';
import { FocasEventLog } from '../components/FocasEventLog';
import { FolderBrowser } from '../components/FolderBrowser';
import { GCodeViewer } from '../components/filemanager/GCodeViewer';
import { MachineTopBar } from '../components/MachineTopBar';

export function Scheduler() {
  const user = useAuthStore((state) => state.user);
  const {
    selectedMachineId,
    setSchedulerRows,
    setSchedulerState,
    setDncConfig,
    clearSchedulerError,
  } = useMachineStore();
  const machines = useMachineStore((s) => s.machines);
  const telemetry = useMachineTelemetry(selectedMachineId || '');
  const focasEvents = useFocasEvents(selectedMachineId || '');
  const rows = useSchedulerRows(selectedMachineId || '');
  const schedulerState = useSchedulerState(selectedMachineId || '');
  const schedulerError = useSchedulerError(selectedMachineId || '');
  const dncConfig = useDncConfig(selectedMachineId || '');
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [editingPathKey, setEditingPathKey] = useState<'path1' | 'path2' | 'path3'>('path1');
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  // DNC config 로드
  useEffect(() => {
    if (!selectedMachineId) return;
    dncApi.getConfig(selectedMachineId).then((res) => {
      if (res.success && res.data) {
        const d = res.data as { machineId: string; dncConfig: { path1?: string; path2?: string; path3?: string; mainMode?: string; subMode?: string; executionMode?: string } };
        if (d.dncConfig && (d.dncConfig.path1 !== undefined || d.dncConfig.path2 !== undefined)) {
          // 하위호환: 서버에 구버전 executionMode만 있으면 mainMode로 사용
          const mainMode = (d.dncConfig.mainMode ?? d.dncConfig.executionMode ?? 'memory') as 'memory' | 'dnc';
          const subMode  = (d.dncConfig.subMode ?? 'memory') as 'memory' | 'dnc';
          setDncConfig(selectedMachineId, {
            machineId: selectedMachineId,
            pathCount,
            mainMode,
            subMode,
            dncPaths: { path1: d.dncConfig.path1 || '', path2: d.dncConfig.path2 || '', path3: d.dncConfig.path3 },
          });
        }
      }
    }).catch(() => null);
  }, [selectedMachineId]);

  // ── 행 추가 ──────────────────────────────────────────────────────────────
  const handleAddRow = async () => {
    if (!selectedMachineId) return;
    try {
      const mainProgramNo = dncConfig?.defaultMainPgm?.trim() || '';
      const subProgramNo  = dncConfig?.defaultSubPgm?.trim()  || undefined;
      const preset        = dncConfig?.defaultPreset ?? 10;
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

  // DNC 설정 컨텐츠
  const dncSettingsContent = (
    <DncSettingsContent
      pathCount={pathCount}
      dncConfig={dncConfig}
      isAdmin={isAdminOrEngineer}
      isSchedulerRunning={schedulerState === 'RUNNING'}
      onOpenFolderBrowser={(pathKey) => { setEditingPathKey(pathKey); setFolderBrowserOpen(true); }}
      onSave={(paths, mainMode, subMode, defaults) => {
        if (!selectedMachineId) return;
        const config: MachineDncConfig = {
          machineId: selectedMachineId,
          pathCount,
          mainMode,
          subMode,
          dncPaths: paths,
          defaultMainPgm: defaults.mainPgm || undefined,
          defaultSubPgm:  defaults.subPgm  || undefined,
          defaultPreset:  defaults.preset  ?? undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: user?.username,
        };
        setDncConfig(selectedMachineId, config);
        // 기본값은 localStorage만 저장; DNC 경로/모드는 서버에도 저장
        dncApi.saveConfig(selectedMachineId, {
          path1: paths.path1,
          path2: paths.path2,
          path3: paths.path3,
          mainMode,
          subMode,
        }).catch(() => null);
      }}
    />
  );

  return (
    <div className="p-6 space-y-4">
      <MachineTopBar pageTitle="스케줄러" pageId="scheduler" settingsContent={dncSettingsContent} />

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
            mainMode: dncConfig?.mainMode ?? 'memory',
            subMode:  dncConfig?.subMode  ?? 'memory',
            dncPaths: updatedPaths,
            updatedAt: new Date().toISOString(),
            updatedBy: user?.username,
          };
          setDncConfig(selectedMachineId, config);
          dncApi.saveConfig(selectedMachineId, { path1: updatedPaths.path1, path2: updatedPaths.path2, path3: updatedPaths.path3 }).catch(() => null);
        }}
        onClose={() => setFolderBrowserOpen(false)}
      />

      {selectedMachineId && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 좌측: NC 모니터(탭 숨김) + 알람/메시지 + 탭 바 */}
            <div className="flex flex-col gap-2 h-[580px]">
              <div className="flex-1 min-h-0">
                <NCMonitor
                  path1={telemetry?.path1}
                  path2={telemetry?.path2}
                  machineMode={telemetry?.mode ? `PROGRAM( ${telemetry.mode} )` : undefined}
                  machineId={selectedMachineId || undefined}
                  activeTab={monitorTab}
                  onTabChange={setMonitorTab}
                  hideTabs
                />
              </div>
              <AlarmStrip alarms={activeAlarms} pmcMessages={activePmcMessages} />
              {/* 탭 바 — 리모트 패널과 동일한 위치 */}
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
            </div>

            {/* 우측: 스케줄러 */}
            <div className="bg-gray-800 text-white rounded-lg shadow p-4 flex flex-col h-[580px]">

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
                    (dncConfig?.mainMode ?? 'memory') === 'dnc'
                      ? 'bg-purple-700/60 text-purple-200'
                      : 'bg-gray-600 text-gray-300'
                  }`}>
                    {(dncConfig?.mainMode ?? 'memory') === 'dnc' ? 'DNC' : 'MEM'}
                  </span>
                  {pathCount >= 2 && <>
                    <span className="text-[10px] text-gray-400 ml-1">서브</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                      (dncConfig?.subMode ?? 'memory') === 'dnc'
                        ? 'bg-purple-700/60 text-purple-200'
                        : 'bg-gray-600 text-gray-300'
                    }`}>
                      {(dncConfig?.subMode ?? 'memory') === 'dnc' ? 'DNC' : 'MEM'}
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
              <div className="overflow-auto flex-1 min-h-0">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col className="w-8" />      {/* No */}
                    <col className="w-24" />     {/* 메인PGM */}
                    <col className="w-24" />     {/* 서브PGM */}
                    <col className="w-16" />     {/* PRESET */}
                    <col className="w-12" />     {/* COUNT */}
                    <col className="w-[72px]" /> {/* 상태 */}
                    <col className="w-8" />      {/* ✕ */}
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
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAddRow}
                  disabled={!isAdminOrEngineer || schedulerState === 'RUNNING'}
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
          </div>

          {/* FOCAS 이벤트 로그 */}
          <FocasEventLog events={focasEvents} />
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
  onDelete,
  onBlur,
}: {
  row: SchedulerRow;
  index: number;
  isCurrentRow: boolean;
  isMachineRunning: boolean;
  canEdit: boolean;
  onDelete: () => void;
  onBlur: (rowId: string, field: keyof SchedulerRow, value: string | number | null) => void;
}) {
  const [mainPgm, setMainPgm] = useState((row.mainProgramNo ?? '').replace(/^O/i, ''));
  const [subPgm, setSubPgm] = useState((row.subProgramNo ?? '').replace(/^O/i, ''));
  const [preset, setPreset] = useState(String(row.preset));

  // row 변경 시 로컬 state 동기화 (WS 업데이트)
  useEffect(() => { setMainPgm((row.mainProgramNo ?? '').replace(/^O/i, '')); }, [row.mainProgramNo]);
  useEffect(() => { setSubPgm((row.subProgramNo ?? '').replace(/^O/i, '')); }, [row.subProgramNo]);
  useEffect(() => { setPreset(String(row.preset)); }, [row.preset]);

  const hasError = row.status === 'PENDING' && !!row.lastError;

  return (
    <tr className={`
      ${isCurrentRow ? 'bg-green-900/20' : ''}
      ${hasError ? 'bg-orange-900/20' : ''}
    `}>
      <td className="px-1 py-1.5 text-center text-gray-400 font-mono text-xs">{index + 1}</td>

      {/* 메인 PGM */}
      <td className="px-1 py-1.5">
        <div className="flex items-center">
          <span className="font-mono text-xs text-gray-400 mr-0.5">O</span>
          <input
            type="text"
            value={mainPgm}
            onChange={(e) => setMainPgm(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onBlur={() => onBlur(row.id, 'mainProgramNo', mainPgm ? `O${mainPgm}` : '')}
            disabled={!canEdit}
            className="w-[52px] px-1 py-0.5 border border-gray-600 rounded font-mono text-xs bg-gray-700 text-white disabled:opacity-50 focus:border-blue-500 focus:outline-none"
            placeholder="0001"
          />
        </div>
      </td>

      {/* 서브 PGM */}
      <td className="px-1 py-1.5">
        <div className="flex items-center">
          <span className="font-mono text-xs text-gray-400 mr-0.5">O</span>
          <input
            type="text"
            value={subPgm}
            onChange={(e) => setSubPgm(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onBlur={() => onBlur(row.id, 'subProgramNo', subPgm ? `O${subPgm}` : null)}
            disabled={!canEdit}
            className="w-[52px] px-1 py-0.5 border border-gray-600 rounded font-mono text-xs bg-gray-700 text-white disabled:opacity-50 focus:border-blue-500 focus:outline-none"
            placeholder="9001"
          />
        </div>
      </td>

      {/* PRESET */}
      <td className="px-1 py-1.5 text-center">
        <input
          type="number"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          onBlur={() => onBlur(row.id, 'preset', parseInt(preset) || 1)}
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
    <div className={`shrink-0 h-[96px] rounded-lg border px-3 py-2 flex flex-col gap-1 overflow-y-auto transition-colors ${
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

// ── DNC 경로 설정 ─────────────────────────────────────────────────────────────

function ModeToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: 'memory' | 'dnc';
  onChange: (v: 'memory' | 'dnc') => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-20 flex-shrink-0 font-medium">{label}</span>
      <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
        {(['memory', 'dnc'] as const).map((m) => (
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
            {m === 'memory' ? 'Memory' : 'DNC'}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  onSave: (paths: DncPathConfig, mainMode: 'memory' | 'dnc', subMode: 'memory' | 'dnc', defaults: { mainPgm: string; subPgm: string; preset: number | null }) => void;
}) {
  const paths = dncConfig?.dncPaths || { path1: '', path2: '' };
  const [mainMode, setMainMode] = useState<'memory' | 'dnc'>(dncConfig?.mainMode ?? 'memory');
  const [subMode,  setSubMode]  = useState<'memory' | 'dnc'>(dncConfig?.subMode  ?? 'memory');
  const [defMainPgm, setDefMainPgm] = useState(dncConfig?.defaultMainPgm?.replace(/^O/i, '') ?? '');
  const [defSubPgm,  setDefSubPgm]  = useState(dncConfig?.defaultSubPgm?.replace(/^O/i, '')  ?? '');
  const [defPreset,  setDefPreset]  = useState(dncConfig?.defaultPreset != null ? String(dncConfig.defaultPreset) : '');
  const canEdit = isAdmin && !isSchedulerRunning;

  const needsDnc = mainMode === 'dnc' || subMode === 'dnc';

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-gray-900 dark:text-white">DNC 설정</div>

      {isSchedulerRunning && isAdmin && (
        <div className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 rounded">
          스케줄러 실행 중에는 설정을 변경할 수 없습니다
        </div>
      )}
      {!isAdmin && (
        <div className="text-xs text-gray-500 px-1">관리자만 설정을 변경할 수 있습니다 (읽기 전용)</div>
      )}

      {/* Path별 실행 모드 선택 */}
      <div className="space-y-2">
        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">실행 모드</div>
        <ModeToggle label="메인 (Path1)" value={mainMode} onChange={setMainMode} disabled={!canEdit} />
        {pathCount >= 2 && (
          <ModeToggle label="서브 (Path2)" value={subMode} onChange={setSubMode} disabled={!canEdit} />
        )}
      </div>

      {/* DNC 경로 설정 — DNC 모드인 Path만 표시 */}
      {needsDnc && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">DNC 경로 설정</div>
          {mainMode === 'dnc' && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">메인 (Path1)</span>
              <div className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono text-gray-700 dark:text-gray-300 truncate min-h-[32px] flex items-center">
                {paths.path1 || <span className="text-gray-400 italic">미설정</span>}
              </div>
              <button onClick={() => onOpenFolderBrowser('path1')} disabled={!canEdit}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                선택
              </button>
            </div>
          )}
          {subMode === 'dnc' && pathCount >= 2 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">서브 (Path2)</span>
              <div className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono text-gray-700 dark:text-gray-300 truncate min-h-[32px] flex items-center">
                {paths.path2 || <span className="text-gray-400 italic">미설정</span>}
              </div>
              <button onClick={() => onOpenFolderBrowser('path2')} disabled={!canEdit}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                선택
              </button>
            </div>
          )}
          {pathCount >= 3 && (mainMode === 'dnc' || subMode === 'dnc') && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">Path3</span>
              <div className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono text-gray-700 dark:text-gray-300 truncate min-h-[32px] flex items-center">
                {paths.path3 || <span className="text-gray-400 italic">미설정</span>}
              </div>
              <button onClick={() => onOpenFolderBrowser('path3')} disabled={!canEdit}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                선택
              </button>
            </div>
          )}
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
              placeholder="비어있음"
              className="w-16 px-2 py-1 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <span className="text-[10px] text-gray-400">(미입력 시 비어있음)</span>
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
        {needsDnc && (
          <button
            onClick={() => onSave({ path1: '', path2: '', ...(pathCount >= 3 ? { path3: '' } : {}) }, mainMode, subMode, { mainPgm: defMainPgm ? `O${defMainPgm}` : '', subPgm: defSubPgm ? `O${defSubPgm}` : '', preset: defPreset ? parseInt(defPreset) : null })}
            disabled={!canEdit}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-red-500 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            경로 초기화
          </button>
        )}
        <button
          onClick={() => onSave(paths, mainMode, subMode, { mainPgm: defMainPgm ? `O${defMainPgm}` : '', subPgm: defSubPgm ? `O${defSubPgm}` : '', preset: defPreset ? parseInt(defPreset) : null })}
          disabled={!canEdit}
          className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          저장
        </button>
      </div>

      {dncConfig?.updatedAt && (
        <div className="text-xs text-gray-400 text-right">
          마지막 수정: {dncConfig.updatedBy || '-'} ({new Date(dncConfig.updatedAt).toLocaleString()})
        </div>
      )}
    </div>
  );
}

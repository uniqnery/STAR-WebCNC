// MachineTopBar - Machines 하위 페이지 공통 상단바
// Row 1: 페이지 제목 / 설정 아이콘 + 제어권 버튼
// Row 2: 장비 선택+정보(좌) | 인터록 pills + 경광등(우)
// Row 3: 제어권 상태 메시지 + 타이머

import { useState, useEffect, useRef, useMemo, ReactNode } from 'react';
import {
  useMachineStore,
  useMachineTelemetry,
  useControlLock,
} from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { useTemplateStore, type TopBarInterlockField } from '../stores/templateStore';
import { machineApi } from '../lib/api';

export type TopBarPageId = 'remote' | 'scheduler' | 'transfer' | 'backup';

interface MachineTopBarProps {
  pageTitle: string;
  pageId?: TopBarPageId;
  settingsContent?: ReactNode;
}

// A접: pmcVal=1 → 정상(true), pmcVal=0 → 비정상(false)
// B접: pmcVal=0 → 정상(true), pmcVal=1 → 비정상(false)
// 통신 없음(undefined) → undefined (gray)
function getPillOk(
  field: TopBarInterlockField,
  pmcBits: Record<string, 0 | 1> | undefined,
  hasTelemetry: boolean,
): boolean | undefined {
  if (!hasTelemetry) return undefined;
  const raw = (pmcBits ?? {})[field.pmcAddr] ?? 0;
  return field.contact === 'A' ? raw === 1 : raw === 0;
}

export function MachineTopBar({ pageTitle, pageId, settingsContent }: MachineTopBarProps) {
  const user = useAuthStore((s) => s.user);
  const {
    machines,
    selectedMachineId,
    selectMachine,
    acquireControlLock,
    releaseControlLock,
    extendControlLock,
  } = useMachineStore();
  const telemetry = useMachineTelemetry(selectedMachineId || '');
  const controlLock = useControlLock(selectedMachineId || '');
  const machine = machines.find((m) => m.machineId === selectedMachineId);
  const canManage = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';

  // 현재 선택된 장비에 할당된 templateId로 템플릿 조회
  const machineTemplateId = machine?.template?.templateId;
  const { templates, selectedTemplateId: storeSelectedId, loadTemplates } = useTemplateStore();
  const selectedTemplate = useMemo(() => {
    // 1. machine에 templateId가 있으면 그걸로 먼저 찾기
    if (machineTemplateId) {
      const found = templates.find((t) => t.templateId === machineTemplateId);
      if (found) return found;
    }
    // 2. machine에 template 없거나 못 찾으면 → 편집기에서 선택된 템플릿으로 폴백
    if (storeSelectedId) {
      const found = templates.find((t) => t.id === storeSelectedId);
      if (found) return found;
    }
    // 3. 최후 폴백: 첫 번째 템플릿
    return templates[0] ?? null;
  }, [templates, machineTemplateId, storeSelectedId]);

  // 템플릿이 아직 없을 때만 로드 (이미 로드된 경우 재로드하지 않음 — 덮어쓰기 방지)
  useEffect(() => {
    if (templates.length === 0) loadTemplates();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length]);

  // pageId 기반 인터록 페이지 설정
  const pageConfig = useMemo(() => {
    if (!pageId || !selectedTemplate?.topBarInterlock) return null;
    return selectedTemplate.topBarInterlock[pageId] ?? null;
  }, [pageId, selectedTemplate]);

  const interlockEnabled = pageConfig?.interlockEnabled ?? true;
  const activeFields = (pageConfig?.fields ?? []).filter((f) => f.enabled);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Auto-select first machine
  useEffect(() => {
    if (!selectedMachineId && machines.length > 0) {
      selectMachine(machines[0].machineId);
    }
  }, [selectedMachineId, machines, selectMachine]);

  // Control lock state
  const hasControlLock = controlLock?.isOwner ?? false;
  const lockOwner = controlLock?.ownerUsername ?? null;
  const expiresAt = controlLock?.expiresAt ?? null;

  // Timer countdown
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!hasControlLock || !expiresAt) {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && selectedMachineId) {
        void machineApi.releaseControl(selectedMachineId).catch(() => null);
        releaseControlLock(selectedMachineId);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [hasControlLock, expiresAt, selectedMachineId, releaseControlLock]);

  // Close settings dropdown on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Tower light
  const towerRed = telemetry?.alarmActive ?? false;
  const towerYellow = telemetry?.runState === 1;
  const towerGreen = telemetry?.runState === 2;

  const hasTelemetry = !!telemetry;
  const pmcBits = telemetry?.pmcBits;

  const handleControlLock = async () => {
    if (!selectedMachineId || !canManage) return;
    if (hasControlLock) {
      try {
        const res = await machineApi.releaseControl(selectedMachineId);
        if (res.success) releaseControlLock(selectedMachineId);
      } catch {
        releaseControlLock(selectedMachineId);
      }
    } else {
      try {
        const sessionId = crypto.randomUUID();
        const res = await machineApi.acquireControl(selectedMachineId, sessionId);
        if (res.success) acquireControlLock(selectedMachineId, user?.username || 'unknown');
      } catch {
        // Server unavailable — don't grant lock without server
      }
    }
  };

  const handleExtend = async () => {
    if (!selectedMachineId || !hasControlLock) return;
    try {
      await machineApi.extendControl(selectedMachineId);
      extendControlLock(selectedMachineId);
    } catch {
      extendControlLock(selectedMachineId);
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-0 mb-4">
      {/* Row 1: Title / Settings + Control Lock */}
      <div className="flex items-center justify-between py-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{pageTitle}</h1>
        <div className="flex items-center gap-2">
          {settingsContent && (
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setSettingsOpen(!settingsOpen)}
                className={`p-2 rounded-lg transition-colors ${
                  settingsOpen
                    ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title="설정"
              >
                <SettingsIcon className="w-5 h-5" />
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full mt-1 w-[420px] bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 p-4">
                  {settingsContent}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleControlLock}
            disabled={!canManage || !selectedMachineId}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              hasControlLock
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <LockIcon locked={!hasControlLock} className="w-4 h-4" />
            {hasControlLock ? '제어권 해제' : '제어권 획득'}
          </button>
        </div>
      </div>

      {/* Row 2: 좌측(장비선택+경광등) | 우측(인터록 pills) */}
      <div className="grid grid-cols-2 gap-4">
        {/* 좌측: Machine selector + info + Tower light */}
        <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-2.5">
          <select
            value={selectedMachineId || ''}
            onChange={(e) => selectMachine(e.target.value || null)}
            className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white flex-shrink-0"
          >
            <option value="">장비 선택</option>
            {machines.map((m) => (
              <option key={m.id} value={m.machineId}>
                {m.name}
              </option>
            ))}
          </select>
          {machine && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 truncate min-w-0">
              <span className="font-mono">{machine.machineId}</span>
              {machine.template && (
                <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs flex-shrink-0">
                  {machine.template.seriesName}
                </span>
              )}
            </div>
          )}
          {/* 경광등 */}
          <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
            <TowerLightDot on={towerRed}    color="bg-red-500"    glow="shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
            <TowerLightDot on={towerYellow} color="bg-yellow-400" glow="shadow-[0_0_8px_rgba(250,204,21,0.7)]" />
            <TowerLightDot on={towerGreen}  color="bg-green-500"  glow="shadow-[0_0_8px_rgba(34,197,94,0.7)]" />
          </div>
        </div>

        {/* 우측: 인터록 pills */}
        <div className="flex items-center bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-2.5 gap-2">
          {/* 인터록 OFF 배지 */}
          {!interlockEnabled && (
            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-600/40 rounded px-1.5 py-0.5 shrink-0 font-semibold">
              인터록 OFF
            </span>
          )}

          {activeFields.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {activeFields.map((field) => {
                const ok = getPillOk(field, pmcBits, hasTelemetry);
                return (
                  <div
                    key={field.id}
                    title={`${field.pmcAddr} (${field.contact}접)`}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${
                      ok === undefined
                        ? 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                        : ok
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        ok === undefined ? 'bg-gray-400' : ok ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    {field.label}
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-xs text-gray-500">인터록 없음</span>
          )}
        </div>
      </div>

      {/* Row 3: Control lock status */}
      <div
        className={`rounded-b-lg px-4 py-2 text-sm border-t ${
          hasControlLock
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900/30'
            : lockOwner
            ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-900/30'
            : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border-yellow-100 dark:border-yellow-900/30'
        }`}
      >
        {hasControlLock ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span>제어권 활성</span>
              {remaining !== null && (
                <span className="font-mono font-medium">· 남은 시간 {formatTimer(remaining)}</span>
              )}
            </div>
            <button
              onClick={handleExtend}
              className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
            >
              연장
            </button>
          </div>
        ) : lockOwner ? (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span>{lockOwner}님이 제어권을 보유 중입니다</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            <span>제어권을 획득해야 조작할 수 있습니다</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───

function TowerLightDot({ on, color, glow }: { on: boolean; color: string; glow: string }) {
  return (
    <div
      className={`w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600 transition-all ${
        on ? `${color} ${glow}` : 'bg-gray-200 dark:bg-gray-700'
      }`}
    />
  );
}

function LockIcon({ locked, className }: { locked: boolean; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      {locked ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
        />
      )}
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

// RemoteControl Page - 리모트 오퍼레이션 패널

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useMachineStore,
  useMachineTelemetry,
  useFocasEvents,
  useMachineAlarms,
  useControlLock,
  type Alarm,
} from '../stores/machineStore';
import {
  useTemplateStore,
  type PanelGroup,
  type PanelKey,
  type PmcMessageEntry,
  type GroupNameAlign,
  type GroupNameSize,
  type GroupNameWeight,
  type GroupNameColor,
} from '../stores/templateStore';
import { TABS, type MonitorTab } from '../components/NCMonitor';
import { DEFAULT_PANEL_GROUPS } from '../config/pmcTemplate';
import { commandApi } from '../lib/api';
import { NCMonitor } from '../components/NCMonitor';
import { FocasEventLog } from '../components/FocasEventLog';
import { MachineTopBar } from '../components/MachineTopBar';
import { useLongPress } from '../hooks/useLongPress';

export function RemoteControl() {
  const { selectedMachineId, addFocasEvent } = useMachineStore();
  const telemetry = useMachineTelemetry(selectedMachineId || '');
  const focasEvents = useFocasEvents(selectedMachineId || '');
  const activeAlarms = useMachineAlarms(selectedMachineId || '');
  const controlLock = useControlLock(selectedMachineId || '');

  // 템플릿에서 panelLayout 로드
  const { templates, loadTemplates } = useTemplateStore();
  const selectedTemplate = useTemplateStore(
    (s) => s.templates.find((t) => t.id === s.selectedTemplateId) ?? null,
  );

  useEffect(() => {
    if (templates.length === 0) loadTemplates();
  }, [templates.length, loadTemplates]);

  // panelLayout: 템플릿 → fallback DEFAULT_PANEL_GROUPS
  const panelGroups: PanelGroup[] =
    selectedTemplate?.panelLayout && selectedTemplate.panelLayout.length > 0
      ? selectedTemplate.panelLayout
      : DEFAULT_PANEL_GROUPS;

  // PMC 메시지: 템플릿 등록 항목 중 pmcBits에서 활성(1)인 것만 표시
  const pmcBits = telemetry?.pmcBits ?? {};
  const activePmcMessages: PmcMessageEntry[] = (selectedTemplate?.pmcMessages ?? [])
    .filter(m => m.pmcAddr && pmcBits[m.pmcAddr] === 1);

  const hasControlLock = controlLock?.isOwner ?? false;

  const [monitorTab, setMonitorTab] = useState<MonitorTab>('monitor');
  const [activePressId, setActivePressId] = useState<string | null>(null);
  const [activeProgress, setActiveProgress] = useState(0);
  const [activeLabel, setActiveLabel] = useState('');
  const [lampStates, setLampStates] = useState<Record<string, boolean>>({});
  const [buttonWarnings, setButtonWarnings] = useState<Record<string, string>>({});
  const warningTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // 조작 가능 조건: 인터록 + 제어권 (TODO: interlockSatisfied 재활성화 — 실기기 인터락 검증 후)
  const canOperate = hasControlLock; // && interlockSatisfied;

  // 램프 상태: lampAddr이 있으면 telemetry.pmcBits 기반, 없으면 mode/runState fallback
  useEffect(() => {
    const states: Record<string, boolean> = {};
    const pmcBits = telemetry?.pmcBits ?? {};
    const modeMap: Record<string, string> = {
      EDIT: 'EDIT', MEM: 'MEMORY', MDI: 'MDI',
      HANDLE: 'HANDLE', JOG: 'JOG', JOG_HANDLE: 'JOG', DNC: 'DNC',
    };
    for (const group of panelGroups) {
      for (const key of group.keys) {
        if (!key.hasLamp) continue;
        if (key.lampAddr && key.lampAddr in pmcBits) {
          // 실PMC 비트
          states[key.id] = pmcBits[key.lampAddr] === 1;
        } else if (group.name === 'MODE') {
          // PMC 미수신 시 telemetry.mode fallback
          states[key.id] = telemetry?.mode ? modeMap[telemetry.mode] === key.id : false;
        } else if (key.id === 'CYCLE_START') {
          states[key.id] = (telemetry?.runState ?? 0) === 2;
        } else {
          states[key.id] = false;
        }
      }
    }
    setLampStates(states);
  }, [telemetry?.pmcBits, telemetry?.mode, telemetry?.runState, panelGroups]);

  // 경고 설정 (5초 후 자동 제거)
  const setWarning = useCallback((id: string, msg: string) => {
    if (warningTimers.current[id]) clearTimeout(warningTimers.current[id]);
    setButtonWarnings((prev) => ({ ...prev, [id]: msg }));
    warningTimers.current[id] = setTimeout(() => {
      setButtonWarnings((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      delete warningTimers.current[id];
    }, 5000);
  }, []);

  // 타이머 정리
  useEffect(() => {
    const timers = warningTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  // 버튼 실행 핸들러
  const handleButtonExecute = useCallback(async (key: PanelKey) => {
    if (!selectedMachineId || !canOperate) return;

    if (warningTimers.current[key.id]) {
      clearTimeout(warningTimers.current[key.id]);
      delete warningTimers.current[key.id];
    }
    setButtonWarnings((prev) => {
      const next = { ...prev };
      delete next[key.id];
      return next;
    });

    addFocasEvent(selectedMachineId, {
      id: `evt-${Date.now()}`,
      machineId: selectedMachineId,
      type: 'COMMAND_SENT',
      message: `[${key.label}] PMC Write → ${key.reqAddr} = 1`,
      timestamp: new Date().toISOString(),
    });

    try {
      const response = await commandApi.send(selectedMachineId, 'PMC_WRITE', {
        address: key.reqAddr,
        value: 1,
        holdMs: key.timing.holdMs,
      });

      addFocasEvent(selectedMachineId, {
        id: `evt-${Date.now()}-release`,
        machineId: selectedMachineId,
        type: 'COMMAND_ACK',
        message: `[${key.label}] PMC Release → ${key.reqAddr} = 0 (hold ${key.timing.holdMs}ms)`,
        timestamp: new Date().toISOString(),
      });

      if (!response.success) {
        setWarning(key.id, '통신 오류');
      }
    } catch {
      setWarning(key.id, '타임아웃');
      addFocasEvent(selectedMachineId, {
        id: `evt-${Date.now()}-err`,
        machineId: selectedMachineId,
        type: 'COMMAND_SENT',
        message: `[${key.label}] 오류 발생`,
        timestamp: new Date().toISOString(),
      });
    }
  }, [selectedMachineId, canOperate, addFocasEvent, setWarning]);

  return (
    <div className="p-6 space-y-4">
      {/* MachineTopBar */}
      <MachineTopBar
        pageTitle="원격 조작반"
        pageId="remote"
      />

      {/* 2분할 레이아웃: NC 모니터 / 오퍼레이션 패널 (5:5) */}
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
              {/* 탭 바 — 우측 패널 하단과 수평 맞춤 */}
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

            {/* 우측: 오퍼레이션 패널 */}
            <div className="bg-gray-800 text-white rounded-lg shadow p-4 flex flex-col h-[580px]">
              <OperationPanel
                groups={panelGroups}
                lampStates={lampStates}
                buttonWarnings={buttonWarnings}
                disabled={!canOperate}
                activePressId={activePressId}
                onPressStart={(id, label) => { setActivePressId(id); setActiveLabel(label); }}
                onPressProgress={(p) => setActiveProgress(p)}
                onPressEnd={() => { setActivePressId(null); setActiveProgress(0); setActiveLabel(''); }}
                onExecute={handleButtonExecute}
              />
            </div>
          </div>

          {/* FOCAS 이벤트 로그 */}
          <FocasEventLog events={focasEvents} />

          {/* 롱프레스 중앙 오버레이 */}
          {activePressId && (
            <LongPressOverlay progress={activeProgress} label={activeLabel} />
          )}
        </>
      )}
    </div>
  );
}

// ─── 오퍼레이션 패널 (PanelGroup 기반) ───

interface OperationPanelProps {
  groups: PanelGroup[];
  lampStates: Record<string, boolean>;
  buttonWarnings: Record<string, string>;
  disabled: boolean;
  activePressId: string | null;
  onPressStart: (id: string, label: string) => void;
  onPressProgress: (progress: number) => void;
  onPressEnd: () => void;
  onExecute: (key: PanelKey) => void;
}

function OperationPanel({
  groups, lampStates, buttonWarnings, disabled,
  activePressId, onPressStart, onPressProgress, onPressEnd, onExecute,
}: OperationPanelProps) {
  // 같은 줄 그룹을 묶어 "행" 단위로 구성
  const rows: PanelGroup[][] = [];
  for (const group of groups) {
    if (group.sameRowAsPrev && rows.length > 0) {
      rows[rows.length - 1].push(group);
    } else {
      rows.push([group]);
    }
  }

  const lastRowIdx = rows.length - 1;

  const renderGroup = (group: PanelGroup) => {
    const justifyCls = KEYS_JUSTIFY_CLS[group.nameAlign || 'left'];
    return (
      <GroupSection key={group.id} group={group}>
        <div className={`flex flex-wrap gap-2 ${justifyCls}`}>
          {group.keys.map((key) => (
            <PmcButton
              key={key.id}
              panelKey={key}
              lampOn={lampStates[key.id] ?? false}
              warning={buttonWarnings[key.id]}
              disabled={disabled || (activePressId !== null && activePressId !== key.id)}
              onPressStart={onPressStart}
              onPressProgress={onPressProgress}
              onPressEnd={onPressEnd}
              onExecute={onExecute}
            />
          ))}
        </div>
      </GroupSection>
    );
  };

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto px-3 py-2">
      {rows.map((row, ri) => (
        <div key={row[0].id}>
          {ri > 0 && <div className="border-t border-gray-700 mb-3" />}
          {ri === lastRowIdx && <div className="flex-1 min-h-2" />}
          {row.length === 1 ? (
            renderGroup(row[0])
          ) : (
            <div className="flex items-start gap-4">
              {row.map((group, gi) => (
                <div key={group.id} className="flex items-start gap-4">
                  {gi > 0 && <div className="self-stretch w-px bg-gray-700" />}
                  {renderGroup(group)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const GROUP_NAME_SIZE_CLS: Record<GroupNameSize, string> = {
  xs: 'text-[10px]', sm: 'text-xs', base: 'text-sm',
};
const GROUP_NAME_WEIGHT_CLS: Record<GroupNameWeight, string> = {
  normal: 'font-normal', semibold: 'font-semibold', bold: 'font-bold',
};
const GROUP_NAME_COLOR_CLS: Record<GroupNameColor, string> = {
  gray: 'text-gray-500', white: 'text-white', blue: 'text-blue-400',
  green: 'text-green-400', yellow: 'text-yellow-400', red: 'text-red-400',
};
const GROUP_NAME_ALIGN_CLS: Record<GroupNameAlign, string> = {
  left: 'text-left', center: 'text-center', right: 'text-right',
};
const KEYS_JUSTIFY_CLS: Record<GroupNameAlign, string> = {
  left: '', center: 'justify-center', right: 'justify-end',
};

function GroupSection({ group, children }: { group: PanelGroup; children: React.ReactNode }) {
  const sizeCls = GROUP_NAME_SIZE_CLS[group.nameFontSize || 'xs'];
  const weightCls = GROUP_NAME_WEIGHT_CLS[group.nameFontWeight || 'semibold'];
  const colorCls = GROUP_NAME_COLOR_CLS[group.nameColor || 'gray'];
  const alignCls = GROUP_NAME_ALIGN_CLS[group.nameAlign || 'left'];

  return (
    <div>
      <div className={`${sizeCls} ${weightCls} ${colorCls} ${alignCls} mb-2 tracking-widest uppercase`}>
        {group.name}
      </div>
      {children}
    </div>
  );
}

// ─── PMC 버튼 (PanelKey 기반) ───

interface PmcButtonProps {
  panelKey: PanelKey;
  lampOn: boolean;
  warning?: string;
  disabled: boolean;
  onPressStart: (id: string, label: string) => void;
  onPressProgress: (progress: number) => void;
  onPressEnd: () => void;
  onExecute: (key: PanelKey) => void;
}

function PmcButton({ panelKey, lampOn, warning, disabled, onPressStart, onPressProgress, onPressEnd, onExecute }: PmcButtonProps) {
  const { isPressed, progress, handlers } = useLongPress({
    longPressMs: panelKey.timing.longPressMs,
    onComplete: () => { onPressEnd(); onExecute(panelKey); },
    onStart: () => onPressStart(panelKey.id, panelKey.label),
    onCancel: () => onPressEnd(),
    disabled,
  });

  const onPressProgressRef = useRef(onPressProgress);
  onPressProgressRef.current = onPressProgress;
  useEffect(() => {
    if (isPressed) {
      onPressProgressRef.current(progress);
    }
  }, [isPressed, progress]);

  const colorConfig: Record<string, { bg: string; bgPressed: string; border: string; text: string; glow: string }> = {
    green: {
      bg: 'bg-gradient-to-b from-green-600 to-green-700',
      bgPressed: 'bg-gradient-to-b from-green-700 to-green-800',
      border: 'border-green-500/60',
      text: 'text-green-50',
      glow: 'shadow-[0_0_12px_rgba(34,197,94,0.3)]',
    },
    yellow: {
      bg: 'bg-gradient-to-b from-yellow-600 to-yellow-700',
      bgPressed: 'bg-gradient-to-b from-yellow-700 to-yellow-800',
      border: 'border-yellow-500/60',
      text: 'text-yellow-50',
      glow: 'shadow-[0_0_12px_rgba(234,179,8,0.3)]',
    },
    red: {
      bg: 'bg-gradient-to-b from-red-600 to-red-700',
      bgPressed: 'bg-gradient-to-b from-red-700 to-red-800',
      border: 'border-red-500/60',
      text: 'text-red-50',
      glow: 'shadow-[0_0_12px_rgba(239,68,68,0.3)]',
    },
    blue: {
      bg: 'bg-gradient-to-b from-blue-600 to-blue-700',
      bgPressed: 'bg-gradient-to-b from-blue-700 to-blue-800',
      border: 'border-blue-500/60',
      text: 'text-blue-50',
      glow: 'shadow-[0_0_12px_rgba(59,130,246,0.3)]',
    },
    gray: {
      bg: 'bg-gradient-to-b from-gray-600 to-gray-700',
      bgPressed: 'bg-gradient-to-b from-gray-700 to-gray-800',
      border: 'border-gray-500/60',
      text: 'text-gray-100',
      glow: '',
    },
  };

  const c = colorConfig[panelKey.color || 'gray'];

  const sizeConfig: Record<string, { w: string; h: string; font: string }> = {
    small:  { w: 'w-[56px]', h: 'h-[70px]', font: 'text-[9px]' },
    normal: { w: 'w-[70px]', h: 'h-[86px]', font: 'text-[10px]' },
    wide:   { w: 'w-[110px]', h: 'h-[86px]', font: 'text-[10px]' },
    large:  { w: 'w-[80px]', h: 'h-[96px]', font: 'text-[11px]' },
  };
  const sz = sizeConfig[panelKey.size] || sizeConfig.normal;
  const btnW = sz.w;
  const btnH = sz.h;
  const fontSize = sz.font;

  return (
    <button
      {...handlers}
      disabled={disabled}
      className={`relative ${btnW} ${btnH} rounded-lg border transition-all select-none touch-none
        flex flex-col items-center justify-center shrink-0
        ${disabled ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer'}
        ${isPressed
          ? `${c.bgPressed} border-white/30 scale-[0.96] shadow-inner`
          : `${c.bg} ${c.border} ${!disabled ? c.glow : ''} ${!disabled ? 'hover:brightness-110' : ''} shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_4px_rgba(0,0,0,0.4)]`
        }`}
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
    >
      {panelKey.hasLamp && (
        <span className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border ${
          lampOn
            ? 'bg-green-400 border-green-300 shadow-[0_0_8px_rgba(74,222,128,0.8)]'
            : 'bg-gray-800 border-gray-600'
        }`} />
      )}

      <span className={`${c.text} ${fontSize} font-semibold leading-tight text-center drop-shadow-sm`}>
        {panelKey.label}
      </span>

      {isPressed && (
        <div className="absolute bottom-0 left-1 right-1 h-1 bg-black/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-white/70 rounded-full transition-none"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      {warning && (
        <WarningBadge text={warning} />
      )}
    </button>
  );
}

// ─── 경고 뱃지 (페이드아웃) ───

function WarningBadge({ text }: { text: string }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setFading(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <span
      className={`absolute -top-1 -right-1 px-1 py-0.5 bg-red-600 text-white rounded text-[9px] leading-none transition-opacity duration-1000 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {text}
    </span>
  );
}

// ─── 실시간 알람/메시지 스트립 ───

interface AlarmStripProps {
  alarms: Alarm[];
  pmcMessages?: PmcMessageEntry[];
}

function AlarmStrip({ alarms, pmcMessages = [] }: AlarmStripProps) {
  const hasAlarms = alarms.length > 0;
  const hasMsgs = pmcMessages.length > 0;
  const hasAny = hasAlarms || hasMsgs;

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
              <span className="flex-1 text-[11px] text-red-200 leading-4 truncate">
                {a.alarmMsg}
              </span>
              <span className="shrink-0 text-[10px] text-red-500/70 leading-4 tabular-nums">
                {new Date(a.occurredAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))}
          {pmcMessages.map((m) => (
            <div key={m.id} className="flex items-start gap-2 min-w-0 shrink-0">
              <span className="shrink-0 text-[10px] font-bold text-yellow-500 leading-4">MSG</span>
              <span className="flex-1 text-[11px] text-yellow-200 leading-4 truncate">
                {m.message}
              </span>
            </div>
          ))}
        </>
      ) : (
        <span className="text-[11px] text-gray-600 m-auto">알람 없음</span>
      )}
    </div>
  );
}

// ─── 롱프레스 중앙 오버레이 ───

function LongPressOverlay({ progress, label }: { progress: number; label: string }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 pointer-events-none">
      <div className="flex flex-col items-center gap-3">
        <svg width="120" height="120" className="transform -rotate-90">
          <circle cx="60" cy="60" r={radius} stroke="#374151" strokeWidth="6" fill="none" />
          <circle
            cx="60" cy="60" r={radius}
            stroke="#60a5fa"
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-none"
          />
        </svg>
        <span className="text-white text-sm font-medium">{label}</span>
        <span className="text-gray-400 text-xs">손을 떼면 취소</span>
      </div>
    </div>
  );
}

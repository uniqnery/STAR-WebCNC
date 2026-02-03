// RemoteControl Page - 리모트 오퍼레이션 패널
// 스케줄러와 동일 레이아웃, 우측 패널만 PMC 기반 오퍼레이션 패널로 교체

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useMachineStore,
  useMachineTelemetry,
  useFocasEvents,
  InterlockStatus,
} from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { machineApi, commandApi } from '../lib/api';
import { NCMonitor } from '../components/NCMonitor';
import { FocasEventLog } from '../components/FocasEventLog';
import { useLongPress } from '../hooks/useLongPress';
import {
  DEFAULT_PMC_TEMPLATE,
  PmcButtonDef,
  getButtonsByCategory,
} from '../config/pmcTemplate';

export function RemoteControl() {
  const user = useAuthStore((state) => state.user);
  const { machines, selectedMachineId, selectMachine, addFocasEvent } = useMachineStore();
  const telemetry = useMachineTelemetry(selectedMachineId || '');
  const focasEvents = useFocasEvents(selectedMachineId || '');

  const [hasControlLock, setHasControlLock] = useState(false);
  const [controlLockOwner, setControlLockOwner] = useState<string | null>(null);
  const [activePressId, setActivePressId] = useState<string | null>(null);
  const [activeProgress, setActiveProgress] = useState(0);
  const [activeLabel, setActiveLabel] = useState('');
  const [lampStates, setLampStates] = useState<Record<string, boolean>>({});
  const [buttonWarnings, setButtonWarnings] = useState<Record<string, string>>({});
  const warningTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const machine = machines.find((m) => m.machineId === selectedMachineId);
  const canManage = user?.role === 'ADMIN' || user?.role === 'AS';

  // 인터록 조건 전체 만족 여부
  const interlock = telemetry?.interlock;
  const interlockSatisfied = interlock
    ? interlock.doorLock && interlock.memoryMode
    : false;

  // 조작 가능 조건: 인터록 + 제어권
  const canOperate = hasControlLock && interlockSatisfied;

  // 조작 불가 이유
  const getDisabledReason = () => {
    if (!selectedMachineId) return '';
    if (!hasControlLock) {
      if (controlLockOwner) return `${controlLockOwner}님이 제어권을 보유 중입니다`;
      return '제어권을 획득해야 조작할 수 있습니다';
    }
    if (!interlockSatisfied) return '인터록 조건이 만족되지 않았습니다';
    return '';
  };

  // 제어권 상태 확인
  useEffect(() => {
    if (!selectedMachineId) return;
    const checkLock = async () => {
      try {
        const response = await machineApi.getById(selectedMachineId);
        if (response.success && response.data) {
          const data = response.data as any;
          const lock = data.realtime?.controlLock;
          if (lock) {
            setHasControlLock(lock.ownerId === user?.id);
            setControlLockOwner(lock.ownerUsername);
          } else {
            setHasControlLock(false);
            setControlLockOwner(null);
          }
        }
      } catch (err) {
        console.error('Failed to check control lock:', err);
      }
    };
    checkLock();
  }, [selectedMachineId, user?.id]);

  // 제어권 획득/해제
  const handleControlLock = async () => {
    if (!selectedMachineId || !canManage) return;
    setHasControlLock(!hasControlLock);
  };

  // Mock 램프 상태 (실제 구현 시 PMC-R Read로 교체)
  useEffect(() => {
    const states: Record<string, boolean> = {};
    // MODE 램프: 현재 모드에 해당하는 키만 ON
    const modeMap: Record<string, string> = {
      EDIT: 'EDIT', MEM: 'MEMORY', MDI: 'MDI', JOG: 'JOG', DNC: 'DNC',
    };
    DEFAULT_PMC_TEMPLATE.forEach((btn) => {
      if (btn.category === 'MODE') {
        states[btn.id] = telemetry?.mode ? modeMap[telemetry.mode] === btn.id : false;
      } else if (btn.hasLamp) {
        states[btn.id] = false;
      }
    });
    // CYCLE START 램프: 가동 중일 때 ON
    if (telemetry?.runState === 2) states['CYCLE_START'] = true;
    setLampStates(states);
  }, [telemetry?.mode, telemetry?.runState]);

  // Mock 경광등 상태
  const towerRed = telemetry?.alarmActive ?? false;
  const towerYellow = telemetry?.runState === 1;
  const towerGreen = telemetry?.runState === 2;

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
  const handleButtonExecute = useCallback(async (def: PmcButtonDef) => {
    if (!selectedMachineId || !canOperate) return;

    // 경고 초기화 + 기존 타이머 제거
    if (warningTimers.current[def.id]) {
      clearTimeout(warningTimers.current[def.id]);
      delete warningTimers.current[def.id];
    }
    setButtonWarnings((prev) => {
      const next = { ...prev };
      delete next[def.id];
      return next;
    });

    // 이벤트 로그: 명령 전송
    addFocasEvent(selectedMachineId, {
      id: `evt-${Date.now()}`,
      machineId: selectedMachineId,
      type: 'COMMAND_SENT',
      message: `[${def.label}] PMC Write → ${def.reqAddr} = 1`,
      timestamp: new Date().toISOString(),
    });

    try {
      const response = await commandApi.send(selectedMachineId, 'PMC_WRITE', {
        address: def.reqAddr,
        value: 1,
        holdMs: def.timing.holdMs,
      });

      // Hold 후 해제 로그
      addFocasEvent(selectedMachineId, {
        id: `evt-${Date.now()}-release`,
        machineId: selectedMachineId,
        type: 'COMMAND_ACK',
        message: `[${def.label}] PMC Release → ${def.reqAddr} = 0 (hold ${def.timing.holdMs}ms)`,
        timestamp: new Date().toISOString(),
      });

      if (!response.success) {
        setWarning(def.id, '통신 오류');
      }
    } catch {
      setWarning(def.id, '타임아웃');
      addFocasEvent(selectedMachineId, {
        id: `evt-${Date.now()}-err`,
        machineId: selectedMachineId,
        type: 'COMMAND_SENT',
        message: `[${def.label}] 오류 발생`,
        timestamp: new Date().toISOString(),
      });
    }
  }, [selectedMachineId, canOperate, addFocasEvent]);

  // 장비 미선택 시
  if (!selectedMachineId || !machine) {
    return (
      <div className="p-6">
        <div className="mb-6 flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">리모트 컨트롤</h1>
          <select
            value=""
            onChange={(e) => selectMachine(e.target.value || null)}
            className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">장비 선택</option>
            {machines.map((m) => (
              <option key={m.id} value={m.machineId}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center text-gray-500">
          리모트 컨트롤을 사용하려면 장비를 선택하세요
        </div>
      </div>
    );
  }

  const disabledReason = getDisabledReason();

  return (
    <div className="p-6 space-y-4">
      {/* Header: 제목 + 장비선택 + 제어권 */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">리모트 컨트롤</h1>
          <select
            value={selectedMachineId}
            onChange={(e) => selectMachine(e.target.value || null)}
            className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">장비 선택</option>
            {machines.map((m) => (
              <option key={m.id} value={m.machineId}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="text-right">
          <button
            onClick={handleControlLock}
            disabled={!canManage}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              hasControlLock
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {hasControlLock ? '제어권 해제' : '제어권 획득'}
          </button>
          <p className={`text-sm mt-1 ${
            hasControlLock ? 'text-green-600' : controlLockOwner ? 'text-red-500' : 'text-gray-500'
          }`}>
            {hasControlLock ? '제어권을 보유하고 있습니다' : controlLockOwner ? `${controlLockOwner}님이 사용중입니다` : '제어권 획득이 가능합니다'}
          </p>
        </div>
      </div>

      {/* Interlock Bar */}
      <InterlockBar interlock={telemetry?.interlock} />

      {/* 조작 불가 안내 */}
      {disabledReason && (
        <div className="p-3 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 rounded-lg text-sm">
          {disabledReason}
        </div>
      )}

      {/* 2분할 레이아웃: NC 모니터 / 오퍼레이션 패널 (5:5) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 좌측: NC 모니터 + 경광등 */}
        <div className="h-[580px] relative">
          <NCMonitor
            path1={telemetry?.path1}
            path2={telemetry?.path2}
            machineMode={telemetry?.mode ? `PROGRAM( ${telemetry.mode} )` : undefined}
            machineId={selectedMachineId || undefined}
          />
          <TowerLight red={towerRed} yellow={towerYellow} green={towerGreen} />
        </div>

        {/* 우측: 오퍼레이션 패널 */}
        <div className="bg-gray-800 text-white rounded-lg shadow p-4 flex flex-col h-[580px]">
          <OperationPanel
            template={DEFAULT_PMC_TEMPLATE}
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
    </div>
  );
}

// ─── 오퍼레이션 패널 ───

interface OperationPanelProps {
  template: PmcButtonDef[];
  lampStates: Record<string, boolean>;
  buttonWarnings: Record<string, string>;
  disabled: boolean;
  activePressId: string | null;
  onPressStart: (id: string, label: string) => void;
  onPressProgress: (progress: number) => void;
  onPressEnd: () => void;
  onExecute: (def: PmcButtonDef) => void;
}

function OperationPanel({
  template, lampStates, buttonWarnings, disabled,
  activePressId, onPressStart, onPressProgress, onPressEnd, onExecute,
}: OperationPanelProps) {
  const headButtons = getButtonsByCategory(template, 'HEAD');
  const chuckButtons = getButtonsByCategory(template, 'CHUCKING');
  const modeButtons = getButtonsByCategory(template, 'MODE');
  const opButtons = getButtonsByCategory(template, 'OPERATION');
  const cycleButtons = getButtonsByCategory(template, 'CYCLE');

  const renderButton = (def: PmcButtonDef, size?: 'lg') => (
    <PmcButton
      key={def.id}
      def={def}
      lampOn={lampStates[def.id] ?? false}
      warning={buttonWarnings[def.id]}
      disabled={disabled || !def.enabled || (activePressId !== null && activePressId !== def.id)}
      size={size}
      onPressStart={onPressStart}
      onPressProgress={onPressProgress}
      onPressEnd={onPressEnd}
      onExecute={onExecute}
    />
  );

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto px-3 py-2">
      {/* HEAD + CHUCKING 한 줄, 세로 구분선 */}
      <div className="flex items-start gap-4">
        <CategorySection label="HEAD">
          <div className="flex flex-wrap gap-2">
            {headButtons.filter((b) => b.enabled).map((b) => renderButton(b))}
          </div>
        </CategorySection>
        <div className="self-stretch w-px bg-gray-700" />
        <CategorySection label="CHUCKING">
          <div className="flex flex-wrap gap-2">
            {chuckButtons.map((b) => renderButton(b))}
          </div>
        </CategorySection>
      </div>

      <div className="border-t border-gray-700" />

      {/* MODE */}
      <CategorySection label="MODE">
        <div className="flex flex-wrap gap-2">
          {modeButtons.map((b) => renderButton(b))}
        </div>
      </CategorySection>

      <div className="border-t border-gray-700" />

      {/* OPERATION */}
      <CategorySection label="OPERATION">
        <div className="flex flex-wrap gap-2">
          {opButtons.map((b) => renderButton(b))}
        </div>
      </CategorySection>

      {/* Spacer */}
      <div className="flex-1 min-h-2" />

      <div className="border-t border-gray-700" />

      {/* CYCLE - 큰 버튼 */}
      <CategorySection label="CYCLE">
        <div className="flex flex-wrap gap-3">
          {cycleButtons.map((b) => renderButton(b, 'lg'))}
        </div>
      </CategorySection>
    </div>
  );
}

function CategorySection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 mb-2 font-semibold tracking-widest uppercase">{label}</div>
      {children}
    </div>
  );
}

// ─── PMC 버튼 ───

interface PmcButtonProps {
  def: PmcButtonDef;
  lampOn: boolean;
  warning?: string;
  disabled: boolean;
  size?: 'lg';
  onPressStart: (id: string, label: string) => void;
  onPressProgress: (progress: number) => void;
  onPressEnd: () => void;
  onExecute: (def: PmcButtonDef) => void;
}

function PmcButton({ def, lampOn, warning, disabled, size, onPressStart, onPressProgress, onPressEnd, onExecute }: PmcButtonProps) {
  const { isPressed, progress, handlers } = useLongPress({
    longPressMs: def.timing.longPressMs,
    onComplete: () => onExecute(def),
    onStart: () => onPressStart(def.id, def.label),
    onCancel: () => onPressEnd(),
    disabled,
  });

  // 프로그레스를 부모에 전달 (useEffect로 렌더 외부에서 처리)
  const onPressProgressRef = useRef(onPressProgress);
  onPressProgressRef.current = onPressProgress;
  useEffect(() => {
    if (isPressed) {
      onPressProgressRef.current(progress);
    }
  }, [isPressed, progress]);

  // 색상별 스타일 (그라데이션 + 보더 + 글로우)
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

  const c = colorConfig[def.color || 'gray'];
  // 일반 버튼: 70x86 (4:5), CYCLE 버튼: 72x90 (4:5)
  const btnW = size === 'lg' ? 'w-[72px]' : 'w-[70px]';
  const btnH = size === 'lg' ? 'h-[90px]' : 'h-[86px]';
  const fontSize = size === 'lg' ? 'text-[11px]' : 'text-[10px]';

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
      {/* 램프 표시등 */}
      {def.hasLamp && (
        <span className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border ${
          lampOn
            ? 'bg-green-400 border-green-300 shadow-[0_0_8px_rgba(74,222,128,0.8)]'
            : 'bg-gray-800 border-gray-600'
        }`} />
      )}

      {/* 버튼 라벨 */}
      <span className={`${c.text} ${fontSize} font-semibold leading-tight text-center drop-shadow-sm`}>
        {def.label}
      </span>

      {/* 롱프레스 프로그레스 바 (버튼 하단) */}
      {isPressed && (
        <div className="absolute bottom-0 left-1 right-1 h-1 bg-black/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-white/70 rounded-full transition-none"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      {/* 경고 표시 (페이드아웃 애니메이션) */}
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
    const timer = setTimeout(() => setFading(true), 4000); // 4초 후 페이드 시작
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

// ─── 롱프레스 중앙 오버레이 ───

function LongPressOverlay({ progress, label }: { progress: number; label: string }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 pointer-events-none">
      <div className="flex flex-col items-center gap-3">
        <svg width="120" height="120" className="transform -rotate-90">
          {/* 배경 원 */}
          <circle cx="60" cy="60" r={radius} stroke="#374151" strokeWidth="6" fill="none" />
          {/* 프로그레스 원 */}
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

// ─── 3색 경광등 ───

function TowerLight({ red, yellow, green }: { red: boolean; yellow: boolean; green: boolean }) {
  const lights = [
    { on: red, color: 'bg-red-500', glow: 'shadow-[0_0_12px_rgba(239,68,68,0.7)]' },
    { on: yellow, color: 'bg-yellow-400', glow: 'shadow-[0_0_12px_rgba(250,204,21,0.7)]' },
    { on: green, color: 'bg-green-500', glow: 'shadow-[0_0_12px_rgba(34,197,94,0.7)]' },
  ];

  return (
    <div className="absolute right-3 top-3 flex flex-col gap-2 bg-gray-800/80 rounded-lg p-2">
      {lights.map((light, i) => (
        <div
          key={i}
          className={`w-5 h-5 rounded-full border border-gray-600 ${
            light.on ? `${light.color} ${light.glow}` : 'bg-gray-700'
          }`}
        />
      ))}
    </div>
  );
}

// ─── 인터록 바 (스케줄러와 동일) ───

function InterlockBar({ interlock }: { interlock?: InterlockStatus }) {
  const items = [
    { key: 'doorLock', label: '도어록', value: interlock?.doorLock },
    { key: 'memoryMode', label: '메모리모드', value: interlock?.memoryMode },
    { key: 'barFeederAuto', label: '바피더오토', value: interlock?.barFeederAuto },
    { key: 'coolantOn', label: '절삭유ON', value: interlock?.coolantOn },
    { key: 'machiningMode', label: '머시닝모드', value: interlock?.machiningMode },
    { key: 'cuttingMode', label: '절단모드', value: interlock?.cuttingMode },
    { key: 'extra1', label: '-', value: interlock?.extra1 },
    { key: 'extra2', label: '-', value: interlock?.extra2 },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-3">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div
            key={item.key}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 ${
              item.value === undefined
                ? 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                : item.value
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${
              item.value === undefined ? 'bg-gray-400' : item.value ? 'bg-green-500' : 'bg-red-500'
            }`} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

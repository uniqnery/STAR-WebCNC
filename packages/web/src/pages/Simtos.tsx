// Simtos.tsx — 2026 SIMTOS 전시 데모 메뉴
// 고정 사양: O3001~O3005 메모리 모드 실행, Path2 = O1111 고정

import { useState, useRef, useCallback, useEffect } from 'react';
import { useMachineStore, useMachineTelemetry, useControlLock } from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { commandApi } from '../lib/api';
import { useLongPress } from '../hooks/useLongPress';
import { MachineTopBar } from '../components/MachineTopBar';

// ─── 상수 ────────────────────────────────────────────────────────────────────

const PRODUCTS = [
  { programNo: 'O3001', path1: 3001 },
  { programNo: 'O3002', path1: 3002 },
  { programNo: 'O3003', path1: 3003 },
  { programNo: 'O3004', path1: 3004 },
  { programNo: 'O3005', path1: 3005 },
] as const;

const PATH2_PROGRAM = 1111;
const LONG_PRESS_MS = 1500;
const CYCLE_START_RETRIES = 4;
const CYCLE_START_INTERVAL_MS = 1000;

// ─── 타입 ────────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'success' | 'error';

interface LogEntry {
  id: number;
  time: string;
  user: string;
  programNo: string;
  message: string;
  level: LogLevel;
}

// ─── 인터록 Pill ─────────────────────────────────────────────────────────────

function InterlockPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
      ok
        ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700/40'
        : 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700/40'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      {label}
    </span>
  );
}

// ─── 제품 카드 ───────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: (typeof PRODUCTS)[number];
  isRunning: boolean;
  canOperate: boolean;
  interlockSatisfied: boolean;
  isExecuting: boolean;
  onSelect: (product: (typeof PRODUCTS)[number]) => void;
  onPressStart: (programNo: string) => void;
  onPressProgress: (p: number) => void;
  onPressEnd: () => void;
}

function ProductCard({ product, isRunning, canOperate, interlockSatisfied, isExecuting, onSelect, onPressStart, onPressProgress, onPressEnd }: ProductCardProps) {
  const [runningImgError, setRunningImgError] = useState(false);
  const [mainImgError, setMainImgError] = useState(false);

  useEffect(() => {
    setRunningImgError(false);
  }, [isRunning]);

  // 롱프레스는 실행 중일 때만 완전 비활성 — 제어권/인터록 미충족은 눌러서 팝업 표시
  const pressDisabled = isExecuting;
  const fullyEnabled = canOperate && interlockSatisfied && !isExecuting;

  const onPressProgressRef = useRef(onPressProgress);
  onPressProgressRef.current = onPressProgress;

  const { isPressed, progress, handlers } = useLongPress({
    longPressMs: LONG_PRESS_MS,
    onComplete: () => { onPressEnd(); onSelect(product); },
    onStart: () => onPressStart(product.programNo),
    onCancel: () => onPressEnd(),
    disabled: pressDisabled,
  });

  useEffect(() => {
    if (isPressed) onPressProgressRef.current(progress);
  }, [isPressed, progress]);

  // 가동 중: running.gif → 오류 시 main.jpg 폴백
  // 정지 중: main.jpg
  const imgSrc = isRunning && !runningImgError
    ? `/simtos/${product.programNo}/running.gif`
    : `/simtos/${product.programNo}/main.jpg`;


  return (
    <div
      {...handlers}
      style={{ touchAction: 'none' }}
      className={`
        relative select-none rounded-xl overflow-hidden border-2 transition-all duration-200
        ${isRunning
          ? 'border-green-500 shadow-lg shadow-green-900/20'
          : 'border-gray-600 dark:border-gray-600'}
        ${!isExecuting
          ? 'cursor-pointer hover:border-blue-500 hover:shadow-md hover:shadow-blue-900/20'
          : 'cursor-not-allowed'}
        bg-white dark:bg-gray-700
      `}
    >
      {/* 이미지 영역 */}
      <div className="relative w-full aspect-[4/3] xl:aspect-video bg-gray-200 dark:bg-gray-600 overflow-hidden">
        {mainImgError ? (
          // 플레이스홀더
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-gray-500 text-sm font-mono">{product.programNo}</span>
          </div>
        ) : (
          <img
            src={imgSrc}
            alt={product.programNo}
            className="w-full h-full object-contain xl:object-cover pointer-events-none"
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            onError={() => {
              if (isRunning && !runningImgError) {
                setRunningImgError(true); // running.gif 없음 → main.jpg 폴백
              } else {
                setMainImgError(true); // main.jpg도 없음 → 플레이스홀더
              }
            }}
          />
        )}

        {/* 가동 중 오버레이 뱃지 */}
        {isRunning && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-green-800/80 backdrop-blur-sm px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            <span className="text-green-300 text-xs font-semibold">가동중</span>
          </div>
        )}
      </div>

      {/* 카드 하단 */}
      <div className="px-4 py-3 flex items-center justify-between bg-white dark:bg-gray-700">
        <div>
          <p className="text-gray-900 dark:text-white font-bold text-base font-mono">{product.programNo}</p>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">Path2 · O{PATH2_PROGRAM}</p>
        </div>
        {fullyEnabled && (
          <p className="text-gray-400 dark:text-gray-500 text-[11px]">꾹 눌러 실행</p>
        )}
        {!canOperate && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400">제어권 필요</span>
        )}
        {canOperate && !interlockSatisfied && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">인터록</span>
        )}
      </div>

    </div>
  );
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

export function Simtos() {
  const { user } = useAuthStore();
  const selectedMachineId = useMachineStore((s) => s.selectedMachineId);
  const telemetry = useMachineTelemetry(selectedMachineId || '');
  const controlLock = useControlLock(selectedMachineId || '');

  const [isExecuting, setIsExecuting] = useState(false);
  const [confirmProduct, setConfirmProduct] = useState<(typeof PRODUCTS)[number] | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activePressId, setActivePressId] = useState<string | null>(null);
  const [activeProgress, setActiveProgress] = useState(0);
  const [activeLabel, setActiveLabel] = useState('');
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';
  const canOperate = (controlLock?.isOwner ?? false) && isAdmin;

  // ─── 인터록 ──────────────────────────────────────────────────────────────
  const runState = telemetry?.runState ?? 0;
  const pmcBits = telemetry?.pmcBits ?? {};

  const interlockMem     = pmcBits['R6037.0'] === 1;   // 메모리 모드
  const interlockStop    = pmcBits['R6024.0'] === 0;   // 운전 대기중
  const interlockDoor    = pmcBits['R6011.0'] === 1;   // 도어 닫힘
  const interlockPathAll = pmcBits['R6035.0'] === 1;   // PATH ALL
  const interlockSatisfied = interlockMem && interlockStop && interlockDoor && interlockPathAll;

  const currentProgramNo = telemetry?.programNo ?? '';
  const isAnyRunning = runState >= 2;

  // ─── 로그 ────────────────────────────────────────────────────────────────
  const addLog = useCallback((programNo: string, message: string, level: LogLevel = 'info') => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    setLogs((prev) => {
      const entry: LogEntry = { id: ++logIdRef.current, time, user: user?.username ?? '-', programNo, message, level };
      const next = [...prev, entry];
      return next.length > 50 ? next.slice(-50) : next;
    });
  }, [user]);

  useEffect(() => {
    if (logs.length > 0) {
      if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    }
  }, [logs]);

  // ─── 실행 시퀀스 ─────────────────────────────────────────────────────────
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const executeSequence = useCallback(async (product: (typeof PRODUCTS)[number]) => {
    if (!selectedMachineId) return;
    setIsExecuting(true);
    const pNo = product.programNo;

    try {
      addLog(pNo, '▶ 실행 시작', 'info');

      addLog(pNo, `SEARCH ${pNo} (Path1)`, 'info');
      await commandApi.sendAndWait(selectedMachineId, 'SEARCH_PROGRAM', { programNo: product.path1, path: 1 });
      addLog(pNo, '✓ Path1 선택 완료', 'success');

      addLog(pNo, `SEARCH O${PATH2_PROGRAM} (Path2)`, 'info');
      await commandApi.sendAndWait(selectedMachineId, 'SEARCH_PROGRAM', { programNo: PATH2_PROGRAM, path: 2 });
      addLog(pNo, '✓ Path2 선택 완료', 'success');

      addLog(pNo, '선두 복귀 (Path1)', 'info');
      await commandApi.sendAndWait(selectedMachineId, 'PMC_WRITE', { address: 'R6124.0', value: 1, holdMs: 300 });
      await delay(500);
      addLog(pNo, '✓ Path1 선두 복귀 완료', 'success');

      addLog(pNo, '선두 복귀 (Path2)', 'info');
      await commandApi.sendAndWait(selectedMachineId, 'REWIND_PROGRAM', { path: 2 });
      await delay(300);
      addLog(pNo, '✓ Path2 선두 복귀 완료', 'success');

      for (let attempt = 1; attempt <= CYCLE_START_RETRIES; attempt++) {
        addLog(pNo, `▶ 사이클 스타트 ${attempt}/${CYCLE_START_RETRIES}`, 'info');
        await commandApi.sendAndWait(selectedMachineId, 'PMC_WRITE', { address: 'R6144.0', value: 1, holdMs: 500 });
        await delay(CYCLE_START_INTERVAL_MS);
      }

      const finalRunState = useMachineStore.getState().telemetryMap[selectedMachineId]?.runState ?? 0;
      if (finalRunState >= 2) {
        addLog(pNo, '✓ 가동 확인', 'success');
      } else {
        addLog(pNo, '⚠ 가동 미확인 — 기계 상태를 확인하세요', 'error');
      }
    } catch (err) {
      addLog(pNo, `✕ 오류: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  }, [selectedMachineId, addLog]);

  const handleCardSelect = useCallback((product: (typeof PRODUCTS)[number]) => {
    if (isExecuting) return;
    if (!canOperate) { setAlertMessage('제어권 획득이 필요합니다.'); return; }
    if (!interlockSatisfied) { setAlertMessage('인터록 조건이 만족되지 않았습니다.'); return; }
    setConfirmProduct(product);
  }, [isExecuting, canOperate, interlockSatisfied]);

  const handleConfirm = useCallback(async () => {
    if (!confirmProduct) return;
    const p = confirmProduct;
    setConfirmProduct(null);
    await executeSequence(p);
  }, [confirmProduct, executeSequence]);

  const handleCancel = useCallback(() => setConfirmProduct(null), []);

  // ─── 렌더 ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4">

      {/* ── 표준 TopBar — rightSlot에 SIMTOS 고정 인터록 pills 삽입 ── */}
      <MachineTopBar
        pageTitle="SIMTOS 2026"
        lockDisabled={!interlockSatisfied}
        rightSlot={
          <div className="flex items-center gap-2 flex-wrap w-full">
            <InterlockPill label="메모리 모드"  ok={interlockMem} />
            <InterlockPill label="운전 대기중" ok={interlockStop} />
            <InterlockPill label="도어 닫힘"   ok={interlockDoor} />
            <InterlockPill label="PATH ALL"    ok={interlockPathAll} />
            <div className="ml-auto shrink-0">
              {interlockSatisfied ? (
                <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  실행 가능
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  조건 미충족
                </span>
              )}
            </div>
          </div>
        }
      />

      {/* ── 제품 카드 영역 ── */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 xl:p-6">
        {/* PC: max-w-[80%] 중앙, 태블릿: 전체 폭 */}
        <div className="space-y-4 xl:max-w-[80%] xl:mx-auto">
          {/* 상단 3개 */}
          <div className="grid grid-cols-3 gap-4">
            {PRODUCTS.slice(0, 3).map((p) => (
              <ProductCard
                key={p.programNo}
                product={p}
                isRunning={isAnyRunning && (currentProgramNo === p.programNo || currentProgramNo === `O${p.path1}`)}
                canOperate={canOperate}
                interlockSatisfied={interlockSatisfied}
                isExecuting={isExecuting}
                onSelect={handleCardSelect}
                onPressStart={(id) => { setActivePressId(id); setActiveLabel(id); setActiveProgress(0); }}
                onPressProgress={setActiveProgress}
                onPressEnd={() => { setActivePressId(null); setActiveProgress(0); setActiveLabel(''); }}
              />
            ))}
          </div>

          {/* 하단 2개 — 태블릿: flex 중앙 정렬 / PC: 6col grid 원본 */}
          {/* 태블릿 전용 */}
          <div className="flex justify-center gap-4 xl:hidden">
            {[PRODUCTS[3], PRODUCTS[4]].map((p) => (
              <div key={p.programNo} className="w-1/3">
                <ProductCard
                  product={p}
                  isRunning={isAnyRunning && (currentProgramNo === p.programNo || currentProgramNo === `O${p.path1}`)}
                  canOperate={canOperate}
                  interlockSatisfied={interlockSatisfied}
                  isExecuting={isExecuting}
                  onSelect={handleCardSelect}
                  onPressStart={(id) => { setActivePressId(id); setActiveLabel(id); setActiveProgress(0); }}
                  onPressProgress={setActiveProgress}
                  onPressEnd={() => { setActivePressId(null); setActiveProgress(0); setActiveLabel(''); }}
                />
              </div>
            ))}
          </div>
          {/* PC 전용 (원본 6col grid) */}
          <div className="hidden xl:grid xl:grid-cols-6 gap-4">
            <div className="col-start-2 col-span-2">
              <ProductCard
                product={PRODUCTS[3]}
                isRunning={isAnyRunning && (currentProgramNo === PRODUCTS[3].programNo || currentProgramNo === `O${PRODUCTS[3].path1}`)}
                canOperate={canOperate}
                interlockSatisfied={interlockSatisfied}
                isExecuting={isExecuting}
                onSelect={handleCardSelect}
                onPressStart={(id) => { setActivePressId(id); setActiveLabel(id); setActiveProgress(0); }}
                onPressProgress={setActiveProgress}
                onPressEnd={() => { setActivePressId(null); setActiveProgress(0); setActiveLabel(''); }}
              />
            </div>
            <div className="col-span-2">
              <ProductCard
                product={PRODUCTS[4]}
                isRunning={isAnyRunning && (currentProgramNo === PRODUCTS[4].programNo || currentProgramNo === `O${PRODUCTS[4].path1}`)}
                canOperate={canOperate}
                interlockSatisfied={interlockSatisfied}
                isExecuting={isExecuting}
                onSelect={handleCardSelect}
                onPressStart={(id) => { setActivePressId(id); setActiveLabel(id); setActiveProgress(0); }}
                onPressProgress={setActiveProgress}
                onPressEnd={() => { setActivePressId(null); setActiveProgress(0); setActiveLabel(''); }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 실행 로그 ── */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">실행 로그</span>
          {isExecuting && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
        </div>
        <div ref={logContainerRef} className="h-28 overflow-y-auto px-4 py-2 font-mono text-xs space-y-0.5">
          {logs.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-600 py-2 text-center">— 실행 이력 없음 —</p>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="flex gap-3 py-0.5 min-w-0">
                <span className="text-gray-400 dark:text-gray-500 shrink-0 tabular-nums whitespace-nowrap">{entry.time}</span>
                <span className="text-gray-500 dark:text-gray-400 shrink-0 whitespace-nowrap">{entry.user}</span>
                <span className="text-gray-500 dark:text-gray-500 shrink-0 font-medium whitespace-nowrap">{entry.programNo}</span>
                <span className={`truncate ${
                  entry.level === 'success' ? 'text-green-600 dark:text-green-400' :
                  entry.level === 'error'   ? 'text-red-600 dark:text-red-400' :
                  'text-gray-700 dark:text-gray-300'
                }`}>{entry.message}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* ── 롱프레스 중앙 오버레이 ── */}
      {activePressId && (
        <SimtosLongPressOverlay progress={activeProgress} label={activeLabel} />
      )}

      {/* ── 알림 팝업 (제어권/인터록 미충족) ── */}
      {alertMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-8 w-80 shadow-2xl">
            <div className="flex justify-center mb-4">
              <span className="w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                <svg className="w-6 h-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </span>
            </div>
            <p className="text-gray-700 dark:text-gray-200 text-center font-medium mb-6">{alertMessage}</p>
            <button
              onClick={() => setAlertMessage(null)}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* ── 확인 팝업 ── */}
      {confirmProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-8 w-80 shadow-2xl">
            <h2 className="text-gray-900 dark:text-white text-lg font-bold text-center mb-2">프로그램 실행</h2>
            <p className="text-gray-600 dark:text-gray-300 text-center mb-6">
              <span className="text-blue-600 dark:text-blue-400 font-bold font-mono">{confirmProduct.programNo}</span> 프로그램을 실행하시겠습니까?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
              >
                확인
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── 롱프레스 원형 오버레이 ─────────────────────────────────────────────────

function SimtosLongPressOverlay({ progress, label }: { progress: number; label: string }) {
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

// OffsetView - Wear Offset 표시 및 편집 (Path1/Path2, 페이지네이션, 포커스 셀, 입력 바)

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useControlLock } from '../../stores/machineStore';
import { useAuthStore } from '../../stores/authStore';
import { useSelectedTemplate } from '../../stores/templateStore';
import { ncDataApi } from '../../lib/api';

// FANUC 표준 마모 오프셋 매크로 변수 범위
// X: #2001~#2064, Y: #2401~#2464, Z: #2101~#2164, R: #2201~#2264
type AxisKey = 'x' | 'y' | 'z' | 'r';
const AXES: { key: AxisKey; label: string; apiAxis: string }[] = [
  { key: 'x', label: 'X', apiAxis: 'X' },
  { key: 'y', label: 'Y', apiAxis: 'Y' },
  { key: 'z', label: 'Z', apiAxis: 'Z' },
  { key: 'r', label: 'R', apiAxis: 'R' },
];

interface WearEntry {
  no: number;
  x: number;
  y: number;
  z: number;
  r: number;
}

interface FocusCell {
  toolIdx: number; // 0-based 전체 인덱스
  axisIdx: number; // 0-3
}

interface ConfirmState {
  toolIdx: number;
  axisIdx: number;
  oldValue: number;
  newValue: number;
  isAdditive: boolean;
}

interface OffsetViewProps {
  machineId?: string;
}

export function OffsetView({ machineId }: OffsetViewProps) {
  const template = useSelectedTemplate();
  const controlLock = useControlLock(machineId || '');
  const user = useAuthStore((s) => s.user);

  const toolCount = template?.offsetConfig?.toolCount ?? 64;
  const pageSize = template?.offsetConfig?.pageSize ?? 16;
  const totalPages = Math.ceil(toolCount / pageSize);

  const canEdit = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';
  const hasControl = !!controlLock?.isOwner;
  const canWrite = canEdit && hasControl;

  const [activePath, setActivePath] = useState<1 | 2>(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [entries, setEntries] = useState<WearEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusCell, setFocusCell] = useState<FocusCell | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // 데이터 로드 함수
  const loadOffsets = useCallback((showLoading = false) => {
    if (!machineId) return;
    if (showLoading) setLoading(true);
    let cancelled = false;
    ncDataApi
      .readOffsets(machineId, activePath)
      .then((res) => {
        if (cancelled) return;
        const raw: { no: number; x?: number; y?: number; z?: number; r?: number }[] =
          (res as any)?.data?.tools ?? (res as any)?.data?.entries ?? [];
        const mapped: WearEntry[] = Array.from({ length: toolCount }, (_, i) => {
          const found = raw.find((e) => e.no === i + 1);
          return found
            ? { no: i + 1, x: found.x ?? 0, y: found.y ?? 0, z: found.z ?? 0, r: found.r ?? 0 }
            : { no: i + 1, x: 0, y: 0, z: 0, r: 0 };
        });
        setEntries(mapped);
      })
      .catch(() => { /* 폴링 중 오류는 무시 */ })
      .finally(() => { if (!cancelled && showLoading) setLoading(false); });
    return () => { cancelled = true; };
  }, [machineId, activePath, toolCount]);

  // 초기 로드 + Path/장비 변경 시 리셋
  useEffect(() => {
    setFocusCell(null);
    setInputValue('');
    const cancel = loadOffsets(true);
    return cancel;
  }, [machineId, activePath, toolCount]);  // eslint-disable-line

  // 5초 폴링 (CNC 직접 변경 반영)
  useEffect(() => {
    if (!machineId) return;
    const timer = setInterval(() => loadOffsets(false), 5000);
    return () => clearInterval(timer);
  }, [machineId, activePath, toolCount]);  // eslint-disable-line

  // 현재 페이지 entries
  const pageEntries = useMemo(() => {
    const start = currentPage * pageSize;
    return entries.slice(start, start + pageSize);
  }, [entries, currentPage, pageSize]);

  // 포커스 셀 현재 값
  const focusValue = useMemo(() => {
    if (!focusCell) return null;
    const entry = entries[focusCell.toolIdx];
    if (!entry) return null;
    return entry[AXES[focusCell.axisIdx].key];
  }, [focusCell, entries]);

  // 포커스 이동 (페이지 자동 전환 포함)
  const moveFocus = useCallback(
    (toolIdx: number, axisIdx: number) => {
      const clamped = Math.max(0, Math.min(toolCount - 1, toolIdx));
      const clampedAxis = Math.max(0, Math.min(AXES.length - 1, axisIdx));
      const newPage = Math.floor(clamped / pageSize);
      setCurrentPage(newPage);
      setFocusCell({ toolIdx: clamped, axisIdx: clampedAxis });
      setInputValue('');
    },
    [toolCount, pageSize],
  );

  // 전역 키보드 핸들러
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      if (!focusCell) return;
      const { toolIdx, axisIdx } = focusCell;
      if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(toolIdx - 1, axisIdx); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(toolIdx + 1, axisIdx); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(toolIdx, axisIdx - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus(toolIdx, axisIdx + 1); }
      else if (e.key === 'PageUp') { e.preventDefault(); moveFocus(toolIdx - pageSize, axisIdx); }
      else if (e.key === 'PageDown') { e.preventDefault(); moveFocus(toolIdx + pageSize, axisIdx); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusCell, moveFocus, pageSize]);

  // INPUT 처리 (절댓값)
  const handleInput = useCallback(() => {
    if (!focusCell || !canWrite || focusValue === null) return;
    const parsed = parseFloat(inputValue);
    if (isNaN(parsed)) return;
    setConfirm({ toolIdx: focusCell.toolIdx, axisIdx: focusCell.axisIdx, oldValue: focusValue, newValue: parsed, isAdditive: false });
  }, [focusCell, canWrite, focusValue, inputValue]);

  // +INPUT 처리 (가산)
  const handleAddInput = useCallback(() => {
    if (!focusCell || !canWrite || focusValue === null) return;
    const parsed = parseFloat(inputValue);
    if (isNaN(parsed)) return;
    setConfirm({ toolIdx: focusCell.toolIdx, axisIdx: focusCell.axisIdx, oldValue: focusValue, newValue: focusValue + parsed, isAdditive: true });
  }, [focusCell, canWrite, focusValue, inputValue]);

  // 확인 후 저장
  const handleConfirm = async () => {
    if (!confirm || !machineId) return;
    setSaving(true);
    setWriteError(null);
    const { toolIdx, axisIdx, newValue } = confirm;
    const entry = entries[toolIdx];
    const axis = AXES[axisIdx];
    try {
      const res = await ncDataApi.writeOffset(machineId, activePath, entry.no, axis.apiAxis, newValue) as any;
      if (res?.success === false) {
        setWriteError(res?.error?.message ?? '오프셋 쓰기 실패');
        return;
      }
      setEntries((prev) =>
        prev.map((e, i) => (i === toolIdx ? { ...e, [axis.key]: newValue } : e)),
      );
      setInputValue('');
    } catch (err: any) {
      const msg = err?.message ?? '네트워크 오류';
      setWriteError(msg);
      console.error('writeOffset failed:', err);
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  if (!machineId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        장비를 선택하면 오프셋 데이터가 표시됩니다
      </div>
    );
  }

  const focusEntry = focusCell ? entries[focusCell.toolIdx] : null;
  const focusLabel = focusCell
    ? `T${String(focusEntry?.no ?? '').padStart(2, '0')} ${AXES[focusCell.axisIdx].label}`
    : '—';
  const focusDisplayValue = focusValue !== null && focusValue !== undefined ? focusValue.toFixed(4) : '—';

  return (
    <div className="flex flex-col h-full text-green-400 font-mono text-xs relative">
      {/* 헤더: Path 토글 + 페이지 네비게이션 */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ToggleBtn active={activePath === 1} onClick={() => { setActivePath(1); setCurrentPage(0); }}>PATH1</ToggleBtn>
          <ToggleBtn active={activePath === 2} onClick={() => { setActivePath(2); setCurrentPage(0); }}>PATH2</ToggleBtn>
          {loading && <span className="text-gray-500 text-[10px] animate-pulse">로딩...</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="px-2 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded disabled:opacity-30 hover:bg-gray-600"
          >
            ▲ PG
          </button>
          <span className="text-gray-400 text-[10px] min-w-[48px] text-center">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
            className="px-2 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded disabled:opacity-30 hover:bg-gray-600"
          >
            ▼ PG
          </button>
        </div>
      </div>

      {/* 테이블 헤더 */}
      <div className="grid grid-cols-[40px_1fr_1fr_1fr_1fr] bg-gray-800 px-1 py-1 text-cyan-300 text-[10px] font-semibold border-b border-gray-700 flex-shrink-0">
        <div className="text-center">NO</div>
        {AXES.map((a) => (
          <div key={a.key} className="text-center">{a.label}</div>
        ))}
      </div>

      {/* 테이블 본문 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {pageEntries.map((entry, pageIdx) => {
          const globalIdx = currentPage * pageSize + pageIdx;
          const isRowFocused = focusCell?.toolIdx === globalIdx;
          return (
            <div
              key={entry.no}
              className={`grid grid-cols-[40px_1fr_1fr_1fr_1fr] px-1 py-0.5 border-b border-gray-800 ${
                isRowFocused ? 'bg-gray-800/60' : 'hover:bg-gray-800/30'
              }`}
            >
              <div className="text-center text-cyan-400">{String(entry.no).padStart(2, '0')}</div>
              {AXES.map((a, ai) => {
                const isFocused = isRowFocused && focusCell?.axisIdx === ai;
                const val = entry[a.key];
                return (
                  <div
                    key={a.key}
                    onClick={() => moveFocus(globalIdx, ai)}
                    className={`text-right px-1 cursor-pointer select-none transition-colors ${
                      isFocused
                        ? 'bg-blue-600 text-white rounded-sm'
                        : val !== 0
                        ? 'text-white hover:bg-gray-700/50'
                        : 'text-gray-500 hover:bg-gray-700/50'
                    }`}
                  >
                    {val.toFixed(4)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* 쓰기 오류 표시 */}
      {writeError && (
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-2 py-1 bg-red-900/60 border-t border-red-700 text-[10px] text-red-300">
          <span>⚠ {writeError}</span>
          <button onClick={() => setWriteError(null)} className="text-red-400 hover:text-white">✕</button>
        </div>
      )}

      {/* 하단 입력 바 */}
      <div className="flex-shrink-0 border-t border-gray-700 bg-gray-800 px-2 py-1.5">
        <div className="flex items-center">
          {/* 좌측: WEAR · PATH + 포커스 셀 정보 */}
          <div className="flex items-center gap-2 flex-1">
            <span className="text-gray-400 text-[10px] font-semibold">
              WEAR · PATH{activePath}
            </span>
            {focusCell && (
              <>
                <span className="text-gray-600 text-[10px]">|</span>
                <span className="text-cyan-300 text-[10px] font-semibold">{focusLabel}</span>
                <span className="text-gray-500 text-[10px]">=</span>
                <span className="text-yellow-300 text-[10px] font-mono">{focusDisplayValue}</span>
              </>
            )}
            {focusCell && !canWrite && (
              <span className="text-yellow-500 text-[10px]">제어권 필요</span>
            )}
          </div>

          {/* 우측: 입력값 / +INPUT / INPUT */}
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleInput();
                if (e.key === 'Escape') setInputValue('');
              }}
              disabled={!focusCell || !canWrite}
              placeholder="입력값"
              className="w-24 bg-gray-700 border border-gray-600 focus:border-blue-500 text-white text-right text-[11px] font-mono px-2 py-0.5 rounded outline-none disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleAddInput}
              disabled={!focusCell || !canWrite || inputValue === ''}
              className="px-2.5 py-0.5 text-[10px] font-semibold bg-green-700 text-white rounded hover:bg-green-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              +INPUT
            </button>
            <button
              onClick={handleInput}
              disabled={!focusCell || !canWrite || inputValue === ''}
              className="px-2.5 py-0.5 text-[10px] font-semibold bg-blue-700 text-white rounded hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              INPUT
            </button>
          </div>
        </div>
      </div>

      {/* 확인 다이얼로그 */}
      {confirm && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 min-w-[240px] shadow-xl">
            <div className="text-cyan-300 text-xs font-semibold mb-3">오프셋 변경 확인</div>
            <div className="space-y-1.5 mb-4 text-[11px]">
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">공구/축</span>
                <span className="text-white font-mono">
                  T{String(entries[confirm.toolIdx]?.no ?? '').padStart(2, '0')} {AXES[confirm.axisIdx].label}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">현재값</span>
                <span className="text-yellow-300 font-mono">{confirm.oldValue.toFixed(4)}</span>
              </div>
              {confirm.isAdditive && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-400">입력값</span>
                  <span className="text-blue-300 font-mono">
                    {(confirm.newValue - confirm.oldValue) >= 0 ? '+' : ''}
                    {(confirm.newValue - confirm.oldValue).toFixed(4)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-4 pt-1 border-t border-gray-700">
                <span className="text-gray-400">변경값</span>
                <span className="text-green-400 font-mono font-semibold">{confirm.newValue.toFixed(4)}</span>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirm(null)}
                disabled={saving}
                className="px-3 py-1 text-[11px] bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="px-3 py-1 text-[11px] bg-blue-700 text-white rounded hover:bg-blue-600 disabled:opacity-40"
              >
                {saving ? '저장 중...' : '확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 토글 버튼 ──
function ToggleBtn({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-0.5 text-[10px] font-semibold rounded-sm transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

// ToolLifeView - 공구 수명 관리 (템플릿 기반 ToolLifeConfig, Path1/Path2)

import { useState, useEffect, useCallback } from 'react';
import { useControlLock } from '../../stores/machineStore';
import { useAuthStore } from '../../stores/authStore';
import { useSelectedTemplate, type ToolLifeColumn, type ToolLifeEntry } from '../../stores/templateStore';
import { ncDataApi } from '../../lib/api';

interface ToolDataEntry {
  entry: ToolLifeEntry;
  values: Record<string, number>;
}

const VAR_PREFIX: Record<string, string> = { macro: '#', pcode: '#', ddata: 'D' };

interface ToolLifeViewProps {
  machineId?: string;
}

export function ToolLifeView({ machineId }: ToolLifeViewProps) {
  const template = useSelectedTemplate();
  const controlLock = useControlLock(machineId || '');
  const user = useAuthStore((s) => s.user);

  const canEdit = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';
  const hasControl = !!controlLock?.isOwner;
  const canWrite = canEdit && hasControl;

  const [activePath, setActivePath] = useState<1 | 2>(1);
  const [toolData, setToolData] = useState<ToolDataEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null); // "entryId:colKey"

  const pathConfig = template?.toolLifeConfig?.paths?.find((p) => p.pathNo === activePath);
  const columns = pathConfig?.columns ?? [];
  const entries = pathConfig?.entries ?? [];

  // 데이터 로드
  useEffect(() => {
    if (!machineId || !pathConfig || entries.length === 0) return;
    let cancelled = false;
    setLoading(true);
    ncDataApi
      .readToolLife(machineId, activePath)
      .then((res) => {
        if (cancelled) return;
        // API 응답: { data: { tools: [{ toolNo, values, varNos }] } }
        const raw = ((res as any)?.data?.tools ?? []) as Array<{ toolNo: string; values: Record<string, number> }>;
        const rawMap = Object.fromEntries(raw.map((t) => [t.toolNo, t.values]));
        setToolData(
          entries.map((e) => ({
            entry: e,
            values: e.isSeparator
              ? {}
              : rawMap[e.toolNo] ?? Object.fromEntries(columns.map((c) => [c.key, 0])),
          })),
        );
      })
      .catch(() => {
        if (cancelled) return;
        // 폴백: 0으로 채움
        setToolData(
          entries.map((e) => ({
            entry: e,
            values: e.isSeparator ? {} : Object.fromEntries(columns.map((c) => [c.key, 0])),
          })),
        );
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [machineId, activePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCommit = useCallback(
    async (entryId: string, col: ToolLifeColumn, entry: ToolLifeEntry, newValue: number) => {
      if (!machineId || col.readonly || !canWrite) return;
      const varNo = entry.varNos[col.key];
      if (varNo === undefined) return;

      const cellKey = `${entryId}:${col.key}`;
      setSavingCell(cellKey);
      try {
        await ncDataApi.writeToolLifeVar(machineId, varNo, newValue, col.varType, col.dataType);
        setToolData((prev) =>
          prev.map((td) =>
            td.entry.id === entryId
              ? { ...td, values: { ...td.values, [col.key]: newValue } }
              : td,
          ),
        );
      } catch (err) {
        console.error('writeToolLifeVar failed:', err);
      } finally {
        setSavingCell(null);
      }
    },
    [machineId, canWrite],
  );

  if (!machineId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        장비를 선택하면 공구 수명 데이터가 표시됩니다
      </div>
    );
  }

  if (!pathConfig || columns.length === 0 || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
        <div className="text-sm">템플릿 설정 필요</div>
        <div className="text-xs text-gray-600">
          템플릿 편집기 &gt; 툴라이프 설정에서 PATH{activePath} 공구 목록을 추가하세요
        </div>
        <div className="flex gap-0.5 mt-2">
          <ToggleBtn active={activePath === 1} onClick={() => setActivePath(1)}>PATH1</ToggleBtn>
          <ToggleBtn active={activePath === 2} onClick={() => setActivePath(2)}>PATH2</ToggleBtn>
        </div>
      </div>
    );
  }

  // 사용률 컬럼
  const presetKey = columns.find((c) => c.key.toLowerCase().includes('preset'))?.key;
  const countKey  = columns.find((c) => c.key.toLowerCase().includes('count'))?.key;
  const showUsage = !!presetKey && !!countKey;

  const gridTemplate = `56px ${columns.map(() => '1fr').join(' ')}${showUsage ? ' 80px' : ''}`;

  return (
    <div className="flex flex-col h-full text-green-400 font-mono text-xs">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ToggleBtn active={activePath === 1} onClick={() => { setActivePath(1); setToolData([]); }}>PATH1</ToggleBtn>
          <ToggleBtn active={activePath === 2} onClick={() => { setActivePath(2); setToolData([]); }}>PATH2</ToggleBtn>
          {loading && <span className="text-gray-500 text-[10px] animate-pulse">로딩...</span>}
        </div>
        {!canWrite && (
          <span className="text-yellow-600 text-[10px]">제어권 필요 (읽기 전용)</span>
        )}
      </div>

      {/* 컬럼 헤더 */}
      <div
        className="bg-gray-800 px-2 py-1 text-cyan-300 text-[10px] font-semibold border-b border-gray-700 flex-shrink-0"
        style={{ display: 'grid', gridTemplateColumns: gridTemplate }}
      >
        <div>TOOL</div>
        {columns.map((col) => (
          <div key={col.key} className="text-right">
            {col.label}
            <span className="text-gray-500 ml-0.5 text-[9px]">
              ({VAR_PREFIX[col.varType] ?? '#'})
              {col.unit && ` ${col.unit}`}
            </span>
          </div>
        ))}
        {showUsage && <div className="text-center">USAGE</div>}
      </div>

      {/* 본문 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {toolData.map((td) => {
          if (td.entry.isSeparator) {
            return (
              <div
                key={td.entry.id}
                className="border-b border-gray-800 px-2 py-0.5"
                style={{ display: 'grid', gridTemplateColumns: gridTemplate }}
              >
                <div className="col-span-full border-t border-gray-700 my-1" style={{ gridColumn: `1 / -1` }} />
              </div>
            );
          }

          const preset = presetKey ? (td.values[presetKey] ?? 0) : 0;
          const count  = countKey  ? (td.values[countKey]  ?? 0) : 0;
          const pct = preset > 0 ? (count / preset) * 100 : 0;
          const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-emerald-500';

          return (
            <div
              key={td.entry.id}
              className="border-b border-gray-800 hover:bg-gray-800/50 items-center px-2 py-0.5"
              style={{ display: 'grid', gridTemplateColumns: gridTemplate }}
            >
              <div className="text-cyan-400 font-semibold text-[11px]">{td.entry.toolNo}</div>

              {columns.map((col) => {
                const cellKey = `${td.entry.id}:${col.key}`;
                const isSaving = savingCell === cellKey;
                const value = td.values[col.key] ?? 0;
                const editable = !col.readonly && canWrite;

                return (
                  <div key={col.key} className="text-right">
                    {isSaving ? (
                      <span className="text-blue-400 text-[10px]">...</span>
                    ) : (
                      <CellValue
                        value={value}
                        editable={editable}
                        onCommit={(v) => handleCommit(td.entry.id, col, td.entry, v)}
                      />
                    )}
                  </div>
                );
              })}

              {showUsage && (
                <div className="flex items-center gap-1 px-1">
                  <div className="flex-1 bg-gray-700 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-gray-400 text-[9px] w-7 text-right shrink-0">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {toolData.length === 0 && !loading && (
          <div className="text-center text-gray-600 py-4 text-xs">데이터 없음</div>
        )}
      </div>
    </div>
  );
}

// ── 셀 값 편집 (onBlur commit) ──
function CellValue({ value, editable, onCommit }: {
  value: number;
  editable: boolean;
  onCommit: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const startEdit = useCallback(() => {
    if (!editable) return;
    setEditValue(String(value));
    setEditing(true);
  }, [editable, value]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed) && parsed !== value) onCommit(parsed);
  }, [editValue, value, onCommit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(false);
  }, [commitEdit]);

  if (editing) {
    return (
      <input
        type="number"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={handleKeyDown}
        autoFocus
        className="w-full bg-gray-700 border border-blue-500 text-white text-right text-xs font-mono px-1 py-0 rounded-sm outline-none"
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      className={`text-white text-xs font-mono ${
        editable ? 'cursor-pointer border-l border-l-blue-500/30 pl-1 hover:bg-gray-700/50' : ''
      }`}
    >
      {Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3)}
    </span>
  );
}

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

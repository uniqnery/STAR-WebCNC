// ToolLifeView - 공구 수명 관리 (템플릿 기반 ToolLifeConfig, Path1/Path2)

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useTemplateStore, type ToolLifeColumn, type ToolLifeEntry } from '../../stores/templateStore';
import { machineApi, ncDataApi } from '../../lib/api';
import { wsClient } from '../../lib/wsClient';

interface ToolDataEntry {
  entry: ToolLifeEntry;
  values: Record<string, number | null>;
}

const VAR_PREFIX: Record<string, string> = { macro: '#', pcode: 'P', ddata: 'D' };

interface ToolLifeViewProps {
  machineId?: string;
}

export function ToolLifeView({ machineId }: ToolLifeViewProps) {
  const templates = useTemplateStore(s => s.templates);
  const [assignment, setAssignment] = useState<{ machineId: string; templateId: string } | null>(null);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateError, setTemplateError] = useState('');
  const template = assignment && assignment.machineId === machineId ? templates.find(t => t.templateId === assignment.templateId || t.id === assignment.templateId) : undefined;
  useEffect(() => {
    let cancelled = false;
    let request = 0;
    const refresh = async () => {
      const generation = ++request;
      if (!machineId) { setTemplateLoading(false); return; }
      try {
        const [machine] = await Promise.all([machineApi.getById(machineId), useTemplateStore.getState().refreshTemplates()]);
        if (cancelled || generation !== request) return;
        const templateId = (machine.data as { template?: { templateId?: string } } | undefined)?.template?.templateId;
        if (!machine.success || !templateId) throw new Error('설비에 할당된 템플릿을 확인하지 못했습니다.');
        setAssignment({ machineId, templateId }); setTemplateError('');
      } catch (error) {
        if (!cancelled && generation === request) { setAssignment(null); setTemplateError(error instanceof Error ? error.message : '템플릿 조회 실패'); }
      } finally { if (!cancelled && generation === request) setTemplateLoading(false); }
    };
    setAssignment(null); setTemplateLoading(true); void refresh();
    const visible = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const offConnect = wsClient.onConnect(() => { void refresh(); });
    const offMessage = wsClient.onMessage(message => { if (message.type === 'template_changed') void refresh(); });
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; offConnect(); offMessage(); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [machineId]);
  const user = useAuthStore((s) => s.user);

  const canEdit = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';
  const canWrite = canEdit;

  const [activePath, setActivePath] = useState<1 | 2>(1);
  const [toolData, setToolData] = useState<ToolDataEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null); // "entryId:colKey"
  const generation = useRef(0);

  const pathConfig = template?.toolLifeConfig?.paths?.find((p) => p.pathNo === activePath);
  const columns = pathConfig?.columns ?? [];
  const entries = pathConfig?.entries ?? [];

  // 데이터 로드
  useEffect(() => {
    generation.current++;
    setSavingCell(null);
    setToolData(entries.map(entry => ({ entry, values: {} })));
    setLoadError(null);
    if (!machineId || !pathConfig || entries.length === 0) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    ncDataApi
      .readToolLife(machineId, activePath)
      .then((res) => {
        if (cancelled) return;
        // API 응답: { data: { tools: [{ toolNo, values, varNos }] } }
        if (!res.success) throw new Error(res.error?.message ?? '공구 수명 읽기 실패');
        const raw = (res.data as { tools?: Array<{ toolNo: string; values: Record<string, number | null> }> } | undefined)?.tools;
        if (!Array.isArray(raw)) throw new Error('공구 수명 응답을 확인할 수 없습니다.');
        const rawMap = Object.fromEntries(raw.map((t) => [t.toolNo, t.values]));
        setToolData(
          entries.map((e) => ({
            entry: e,
            values: e.isSeparator
              ? {}
              : Object.fromEntries(columns.map(c => {
                const value = rawMap[e.toolNo]?.[c.key];
                return [c.key, typeof value === 'number' && Number.isFinite(value) ? value : null];
              })),
          })),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '공구 수명 읽기 실패');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; generation.current++; };
  }, [machineId, activePath, pathConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCommit = useCallback(
    async (entryId: string, col: ToolLifeColumn, entry: ToolLifeEntry, newValue: number) => {
      if (!machineId || col.readonly || !canWrite) return;
      const varNo = entry.varNos[col.key];
      if (varNo === undefined) return;

      const cellKey = `${entryId}:${col.key}`;
      const writeGeneration = generation.current;
      setSavingCell(cellKey);
      try {
        const response = await ncDataApi.writeToolLifeVar(machineId, varNo, newValue, col.varType, col.dataType, activePath);
        if (writeGeneration !== generation.current) return;
        const finalValue = (response.data as { value?: number } | undefined)?.value;
        if (!response.success || typeof finalValue !== 'number') {
          alert(response.error?.message ?? '공구수명 최종 반영값 확인 불가. 재조회하세요.');
          return;
        }
        setToolData((prev) =>
          prev.map((td) =>
            td.entry.id === entryId
              ? { ...td, values: { ...td.values, [col.key]: finalValue } }
              : td,
          ),
        );
      } catch (err) {
        console.error('writeToolLifeVar failed:', err);
      } finally {
        if (writeGeneration === generation.current) setSavingCell(null);
      }
    },
    [machineId, canWrite, activePath],
  );

  if (!machineId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        장비를 선택하면 공구 수명 데이터가 표시됩니다
      </div>
    );
  }

  if (templateLoading || templateError) return <div role="status" className="p-3 text-sm text-gray-400">{templateLoading ? '템플릿 확인 중...' : templateError}</div>;

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

  const gridTemplate = `10% repeat(${columns.length + (showUsage ? 1 : 0)}, minmax(0, 1fr))`;

  return (
    <div className="flex flex-col h-full text-green-400 font-mono text-xs">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ToggleBtn active={activePath === 1} onClick={() => setActivePath(1)}>PATH1</ToggleBtn>
          <ToggleBtn active={activePath === 2} onClick={() => setActivePath(2)}>PATH2</ToggleBtn>
          {loading && <span className="text-gray-500 text-[10px] animate-pulse">로딩...</span>}
        </div>
        {!canWrite && (
          <span className="text-yellow-600 text-[10px]">수정 권한 없음 (읽기 전용)</span>
        )}
      </div>

      {loadError && <div role="alert" className="px-2 py-1 text-yellow-400">{loadError}</div>}

      {/* 컬럼 헤더 */}
      <div
        className="bg-gray-800 px-2 py-1 text-cyan-300 text-[10px] font-semibold border-b border-gray-700 flex-shrink-0"
        style={{ display: 'grid', gridTemplateColumns: gridTemplate }}
      >
        <div>TOOL</div>
        {columns.map((col) => (
          <div key={col.key} className="min-w-0 pl-2 text-left">
            {col.label}
            <span className="text-gray-500 ml-0.5 text-[9px]">
              ({VAR_PREFIX[col.varType] ?? '#'})
              {col.unit && ` ${col.unit}`}
            </span>
          </div>
        ))}
        {showUsage && <div className="ml-4 text-center">USAGE</div>}
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

          const preset = presetKey ? td.values[presetKey] : null;
          const count  = countKey ? td.values[countKey] : null;
          const pct = preset != null && count != null ? (preset > 0 ? (count / preset) * 100 : 0) : null;
          const barColor = (pct ?? 0) > 90 ? 'bg-red-500' : (pct ?? 0) > 70 ? 'bg-yellow-500' : 'bg-emerald-500';

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
                const value = td.values[col.key] ?? null;
                const editable = !col.readonly && canWrite && value !== null && !loading;

                return (
                  <div key={col.key} className="min-w-0 pl-2 text-left">
                    {isSaving ? (
                      <span className="text-blue-400 text-[10px]">...</span>
                    ) : (
                      <CellValue
                        key={`${machineId}:${activePath}:${col.varType}:${col.dataType}:${td.entry.varNos[col.key]}`}
                        value={value}
                        editable={editable}
                        onCommit={(v) => handleCommit(td.entry.id, col, td.entry, v)}
                      />
                    )}
                  </div>
                );
              })}

              {showUsage && (
                <div className="ml-4 flex min-w-0 items-center gap-1">
                  <div className="flex-1 bg-gray-700 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${Math.max(0, Math.min(pct ?? 0, 100))}%` }}
                    />
                  </div>
                  <span className="text-gray-400 text-[9px] w-7 text-right shrink-0">
                    {pct === null ? '—' : `${pct.toFixed(0)}%`}
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
  value: number | null;
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
        className="w-full bg-gray-700 border border-blue-500 text-white text-left text-xs font-mono px-1 py-0 rounded-sm outline-none"
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      className={`text-white text-xs font-mono ${
        editable ? 'cursor-pointer pl-1 hover:bg-gray-700/50' : ''
      }`}
    >
      {value === null ? '—' : Math.trunc(value).toLocaleString()}
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

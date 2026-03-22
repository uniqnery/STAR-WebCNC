// CountView - 카운터 변수 표시 및 편집 (템플릿 기반 CounterConfig.fields)

import { useState, useEffect, useCallback } from 'react';
import { useControlLock } from '../../stores/machineStore';
import { useAuthStore } from '../../stores/authStore';
import { useSelectedTemplate, type CounterField } from '../../stores/templateStore';
import { ncDataApi } from '../../lib/api';

interface CountViewProps {
  machineId?: string;
}

export function CountView({ machineId }: CountViewProps) {
  const template = useSelectedTemplate();
  const controlLock = useControlLock(machineId || '');
  const user = useAuthStore((s) => s.user);

  const canEdit = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';
  const hasControl = !!controlLock?.isOwner;
  const canWrite = canEdit && hasControl;

  const fields = template?.counterConfig?.fields ?? [];

  const [vars, setVars] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // 데이터 로드
  useEffect(() => {
    if (!machineId || fields.length === 0) return;
    let cancelled = false;
    setLoading(true);
    ncDataApi
      .readCount(machineId)
      .then((res) => {
        if (cancelled) return;
        const rawVars: Record<string, number> = (res as any)?.data?.vars ?? {};
        setVars(rawVars);
      })
      .catch(() => {
        if (cancelled) return;
        // 로드 실패 시 0으로 초기화
        const init: Record<string, number> = {};
        fields.forEach((f) => { init[f.key] = 0; });
        setVars(init);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [machineId, fields.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCommit = useCallback(
    async (field: CounterField, newValue: number) => {
      if (!machineId || field.readonly || !canWrite) return;
      if (newValue === vars[field.key]) return;
      setSavingKey(field.key);
      try {
        await ncDataApi.writeCountVar(machineId, field.varNo, newValue);
        setVars((prev) => ({ ...prev, [field.key]: newValue }));
      } catch (err) {
        console.error('writeCountVar failed:', err);
      } finally {
        setSavingKey(null);
      }
    },
    [machineId, canWrite, vars],
  );

  if (!machineId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        장비를 선택하면 카운트 데이터가 표시됩니다
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
        <div className="text-sm">템플릿 설정 필요</div>
        <div className="text-xs text-gray-600">템플릿 편집기에서 CounterConfig.fields를 추가하세요</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full font-mono text-xs overflow-y-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <span className="text-cyan-300 text-[10px] font-semibold tracking-widest uppercase">COUNTER VARS</span>
        <div className="flex items-center gap-2">
          {loading && <span className="text-gray-500 text-[10px] animate-pulse">로딩...</span>}
          {!canWrite && (
            <span className="text-yellow-600 text-[10px]">제어권 필요</span>
          )}
        </div>
      </div>

      {/* 변수 목록 */}
      <div className="flex-1 p-2 space-y-px">
        {fields.map((field) => {
          const value = vars[field.key] ?? 0;
          const isSaving = savingKey === field.key;
          const editable = !field.readonly && canWrite;

          return (
            <div
              key={field.key}
              className="flex items-center justify-between py-2 px-2.5 bg-gray-800 rounded hover:bg-gray-800/80 border border-transparent hover:border-gray-700"
            >
              {/* 라벨 + varNo */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-gray-300 text-xs truncate">{field.label}</span>
                <span className="text-gray-600 text-[9px] font-mono shrink-0">
                  #{field.varNo}
                </span>
                {field.readonly && (
                  <span className="text-gray-600 text-[9px] bg-gray-700 px-1 rounded">RO</span>
                )}
              </div>

              {/* 값 / 편집 */}
              <div className="flex items-center gap-1.5 shrink-0">
                {isSaving ? (
                  <span className="text-blue-400 text-[10px]">저장 중...</span>
                ) : (
                  <EditableValue
                    value={value}
                    unit={field.unit}
                    editable={editable}
                    onCommit={(v) => handleCommit(field, v)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 편집 가능한 값 셀 (onBlur commit) ──
function EditableValue({ value, unit, editable, onCommit }: {
  value: number;
  unit?: string;
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
    if (!isNaN(parsed) && parsed !== value) {
      onCommit(parsed);
    }
  }, [editValue, value, onCommit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') setEditing(false);
    },
    [commitEdit],
  );

  if (editing) {
    return (
      <input
        type="number"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={handleKeyDown}
        autoFocus
        className="w-24 bg-gray-700 border border-blue-500 text-white text-right text-sm font-mono font-bold px-2 py-0.5 rounded-sm outline-none"
      />
    );
  }

  return (
    <div className="flex items-baseline gap-1">
      <span
        onClick={startEdit}
        className={`text-white text-sm font-bold font-mono ${
          editable
            ? 'cursor-pointer border-b border-dashed border-blue-500/40 hover:border-blue-500'
            : ''
        }`}
      >
        {Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3)}
      </span>
      {unit && <span className="text-gray-500 text-[9px]">{unit}</span>}
    </div>
  );
}

// CountView - Agent가 설비 템플릿에서 확정한 카운터 변수 표시 및 편집

import { useState, useEffect, useCallback } from 'react';
import { useControlLock } from '../../stores/machineStore';
import { useAuthStore } from '../../stores/authStore';
import type { CounterField } from '../../stores/templateStore';
import { ncDataApi } from '../../lib/api';

interface CountViewProps {
  machineId?: string;
}

export function CountView({ machineId }: CountViewProps) {
  return <MachineCountView key={machineId} machineId={machineId} />;
}

function MachineCountView({ machineId }: CountViewProps) {
  const controlLock = useControlLock(machineId || '');
  const user = useAuthStore((s) => s.user);

  const canEdit = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';
  const hasControl = !!controlLock?.isOwner;
  const canWrite = canEdit && hasControl;

  const [fields, setFields] = useState<(CounterField & { value: number | null })[]>([]);
  const [loading, setLoading] = useState(Boolean(machineId));
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // 데이터 로드
  useEffect(() => {
    if (!machineId) return;
    let cancelled = false;
    setLoading(true);
    ncDataApi
      .readCount(machineId)
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          setError(res.error?.message ?? '카운터 조회 실패');
          return;
        }
        const returnedFields = res.data?.fields ?? [];
        if (returnedFields.some((field) => field.varType !== 'macro' && field.varType !== 'pcode')) {
          setError('카운터 설정을 읽으려면 Agent 업데이트가 필요합니다.');
          return;
        }
        setFields(returnedFields);
      })
      .catch(() => {
        if (cancelled) return;
        setError('카운터 조회 실패');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [machineId]);

  const handleCommit = useCallback(
    async (field: CounterField, newValue: number) => {
      if (!machineId || field.readonly || !canWrite) return;
      setSavingKey(field.key);
      setError(null);
      try {
        const response = await ncDataApi.writeCountVar(machineId, field, newValue);
        if (!response.success) {
          setError(response.error?.message ?? '카운터 쓰기 실패');
          return;
        }
        setFields((prev) => prev.map((item) => item.key === field.key ? { ...item, value: newValue } : item));
      } catch (err) {
        console.error('writeCountVar failed:', err);
        setError('카운터 쓰기 실패');
      } finally {
        setSavingKey(null);
      }
    },
    [machineId, canWrite],
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
        <div className="text-sm">{loading ? '카운터 조회 중…' : error ?? '카운터 설정 없음'}</div>
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

      {error && <div role="alert" className="px-2 py-1 text-red-400">{error}</div>}

      {/* 변수 목록 */}
      <div className="flex-1 p-2 space-y-px">
        {fields.map((field) => {
          const value = field.value;
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
                  {field.varType.toLowerCase() === 'pcode' ? 'P' : '#'}{field.varNo}
                </span>
                {field.readonly && (
                  <span className="text-gray-600 text-[9px] bg-gray-700 px-1 rounded">RO</span>
                )}
              </div>

              {/* 값 / 편집 */}
              <div className="flex items-center gap-1.5 shrink-0">
                {isSaving ? (
                  <span className="text-blue-400 text-[10px]">저장 중...</span>
                ) : value == null ? (
                  <span className="text-gray-500">—</span>
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

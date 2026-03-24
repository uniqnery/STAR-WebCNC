// Template Editor - 숨김 경로 관리 도구 (/admin/templates)
// HQ_ENGINEER/ADMIN 전용: 장비 템플릿 작성/편집/Import/Export

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  useTemplateStore,
  useSelectedTemplate,
  type CncTemplate,
  type PmcAddress,
  type PmcMessageEntry,
  type ToolLifeColumn,
  type ToolLifeEntry,
  type ToolLifePathConfig,
} from '../stores/templateStore';

// ═══════════════════════════════════════════════════════════
//  Utility: Nested field update via dot-notation path
// ═══════════════════════════════════════════════════════════

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === undefined || cur[keys[i]] === null || typeof cur[keys[i]] !== 'object') {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}



// ═══════════════════════════════════════════════════════════
//  Sub-Components (local)
// ═══════════════════════════════════════════════════════════

const PMC_TYPES = ['R', 'D', 'E', 'G', 'Y', 'X', 'F', 'K', 'A', 'C', 'T'] as const;
const DATA_TYPES = ['bit', 'byte', 'word', 'dword'] as const;

// ── PmcAddressField ───────────────────────────────────────
function PmcAddressField({ label, description, value, onChange }: {
  label: string;
  description?: string;
  value: PmcAddress | null;
  onChange: (v: PmcAddress | null) => void;
}) {
  if (value === null) {
    return (
      <div className="flex items-center gap-3 py-1.5">
        <span className="w-36 text-xs text-gray-400 truncate" title={description}>{label}</span>
        <span className="text-xs text-gray-600 italic">미설정</span>
        <button
          onClick={() => onChange({ type: 'R', address: 0, bit: 0, dataType: 'bit' })}
          className="px-2 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
        >+ 설정</button>
        {description && <span className="text-[10px] text-gray-600 truncate">{description}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-36 text-xs text-gray-300 truncate" title={description}>{label}</span>
      <select
        value={value.type}
        onChange={e => onChange({ ...value, type: e.target.value as PmcAddress['type'] })}
        className="w-14 px-1 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white"
      >
        {PMC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input
        type="number"
        value={value.address}
        onChange={e => onChange({ ...value, address: Number(e.target.value) })}
        className="w-20 px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white font-mono [appearance:textfield]"
        placeholder="주소"
      />
      <span className="text-gray-500 text-xs">.</span>
      <input
        type="number"
        min={0}
        max={7}
        value={value.bit}
        onChange={e => onChange({ ...value, bit: Number(e.target.value) })}
        disabled={value.dataType !== 'bit'}
        className="w-10 px-1 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white font-mono disabled:opacity-40 [appearance:textfield]"
      />
      <select
        value={value.dataType}
        onChange={e => onChange({ ...value, dataType: e.target.value as PmcAddress['dataType'] })}
        className="w-16 px-1 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white"
      >
        {DATA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <button
        onClick={() => onChange(null)}
        className="px-1.5 py-0.5 text-[10px] text-red-400 hover:text-red-300"
        title="제거"
      >x</button>
    </div>
  );
}

// ── CollapsibleSection ────────────────────────────────────
function CollapsibleSection({ title, expanded, onToggle, children }: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 bg-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-gray-200 hover:bg-gray-750"
      >
        <span className="text-[10px] text-gray-500">{expanded ? '▼' : '▶'}</span>
        {title}
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-700">
          {children}
        </div>
      )}
    </div>
  );
}

// ── TextInput ─────────────────────────────────────────────
function TextInput({ label, value, onChange, placeholder, mono, wide }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean; wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

// ── NumberInput ───────────────────────────────────────────
function NumberInput({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded-lg text-white font-mono [appearance:textfield]"
      />
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────
function Toggle({ label, value, onChange, description }: {
  label: string; value: boolean; onChange: (v: boolean) => void; description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div>
        <span className="text-sm text-gray-200">{label}</span>
        {description && <p className="text-[10px] text-gray-500">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-600'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

// ── TagInput (축 이름, 옵션 등) ────────────────────────────
function TagInput({ label, tags, onChange, placeholder }: {
  label: string; tags: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const v = input.trim().toUpperCase();
    if (v && !tags.includes(v)) {
      onChange([...tags, v]);
    }
    setInput('');
  };

  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-700 border border-gray-600 rounded-lg min-h-[36px]">
        {tags.map(tag => (
          <span key={tag} className="flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-600 text-gray-200 rounded">
            {tag}
            <button onClick={() => onChange(tags.filter(t => t !== tag))} className="text-gray-400 hover:text-red-400">x</button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          onBlur={addTag}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[60px] bg-transparent text-sm text-white outline-none placeholder-gray-500"
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Section Renderers
// ═══════════════════════════════════════════════════════════

// ── Section 1: Metadata ──────────────────────────────────
function SectionMetadata({ data, update }: { data: CncTemplate; update: (path: string, v: unknown) => void }) {
  return (
    <div className="grid grid-cols-2 gap-4 pt-3">
      <TextInput label="Template ID" value={data.templateId} onChange={v => update('templateId', v)} placeholder="FANUC_0iTF_SR20J_v1" mono />
      <TextInput label="Version" value={data.version} onChange={v => update('version', v)} placeholder="1.0.0" mono />
      <TextInput label="표시명" value={data.name} onChange={v => update('name', v)} placeholder="Star SR-20J Type C (FANUC 0i-TF)" />
      <TextInput label="설명" value={data.description} onChange={v => update('description', v)} placeholder="템플릿 설명 (선택)" />
    </div>
  );
}

// ── Section 2: System Info ───────────────────────────────
function SectionSystemInfo({ data, update }: { data: CncTemplate; update: (path: string, v: unknown) => void }) {
  const si = data.systemInfo;
  return (
    <div className="grid grid-cols-2 gap-4 pt-3">
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">CNC 제조사</label>
        <select
          value={si.cncType}
          onChange={e => update('systemInfo.cncType', e.target.value)}
          className="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded-lg text-white"
        >
          <option value="FANUC">FANUC</option>
          <option value="MITSUBISHI">MITSUBISHI</option>
          <option value="SIEMENS">SIEMENS</option>
        </select>
      </div>
      <TextInput label="컨트롤러 시리즈" value={si.seriesName} onChange={v => update('systemInfo.seriesName', v)} placeholder="0i-TF" />
      <TextInput label="장비 모델명" value={si.modelName} onChange={v => update('systemInfo.modelName', v)} placeholder="SB-20R2" />
      <NumberInput label="계통 수 (Path)" value={si.maxPaths} onChange={v => update('systemInfo.maxPaths', v)} min={1} max={3} />
      <div className="col-span-2">
        <TagInput label="장착 옵션" tags={si.supportedOptions} onChange={v => update('systemInfo.supportedOptions', v)} placeholder="예: PMC-SA1 (Enter로 추가)" />
      </div>
    </div>
  );
}

// ── Section 3: Axis Config ───────────────────────────────
function SectionAxisConfig({ data, update }: { data: CncTemplate; update: (path: string, v: unknown) => void }) {
  const ac = data.axisConfig;
  const maxPaths = data.systemInfo.maxPaths;

  const renderPath = (pathKey: string, cfg: typeof ac.path1, label: string, disabled?: boolean) => (
    <div key={pathKey} className={`p-3 bg-gray-750 rounded-lg ${disabled ? 'opacity-40' : ''}`}>
      <h4 className="text-xs font-semibold text-gray-300 mb-2">{label}</h4>
      {disabled ? (
        <p className="text-xs text-gray-500 italic">이 계통은 사용하지 않습니다 (maxPaths={maxPaths})</p>
      ) : (
        <div className="space-y-3">
          <TagInput label="축 이름 (순서대로)" tags={cfg.axes ?? []} onChange={v => update(`axisConfig.${pathKey}.axes`, v)} placeholder="X, Z, C, Y..." />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="스핀들 이름" value={cfg.spindleName ?? ''} onChange={v => update(`axisConfig.${pathKey}.spindleName`, v)} placeholder="S1" />
            <TextInput label="공구 번호 범위" value={cfg.toolPrefix ?? ''} onChange={v => update(`axisConfig.${pathKey}.toolPrefix`, v)} placeholder="T0100 ~ T1200" />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3 pt-3">
      {renderPath('path1', ac.path1, 'Path 1 (주축)')}
      {renderPath('path2', ac.path2, 'Path 2 (부축)')}
      {renderPath('path3', ac.path3, 'Path 3', maxPaths < 3)}
    </div>
  );
}

// ── Section 4: PMC Map ───────────────────────────────────
function SectionPmcMap({ data, update }: { data: CncTemplate; update: (path: string, v: unknown) => void }) {
  const pm = data.pmcMap;
  const [sub, setSub] = useState<Record<string, boolean>>({
    interlock: true, status: false, control: false, counters: false, scheduler: false,
  });
  const toggleSub = (k: string) => setSub(p => ({ ...p, [k]: !p[k] }));

  const INTERLOCK_FIELDS: [string, string][] = [
    ['doorClosed', '안전 도어 닫힘'],
    ['chuckClamped', '척 클램프 완료'],
    ['spindleStopped', '스핀들 정지'],
    ['coolantLevel', '쿨런트 잔량'],
  ];
  const STATUS_FIELDS: [string, string][] = [
    ['operationMode', '운전 모드'],
    ['cycleRunning', '사이클 실행 중'],
    ['alarmActive', '알람 발생'],
    ['emergencyStop', '비상정지'],
    ['programEnd', '프로그램 종료'],
  ];
  const CONTROL_FIELDS: [string, string][] = [
    ['cycleStart', '사이클 스타트'],
    ['feedHold', '피드 홀드'],
    ['singleBlock', '싱글 블록'],
    ['reset', 'CNC 리셋'],
  ];
  const COUNTER_FIELDS: [string, string][] = [
    ['partCount', '생산 카운터'],
    ['targetCount', '목표 수량'],
    ['cycleTime', '사이클 타임'],
  ];
  const SCHED_FIELDS: [string, string][] = [
    ['loadable', '로딩 가능 신호'],
    ['dataReady', '데이터 준비 완료'],
    ['m20Complete', 'M20 완료 신호'],
  ];

  const renderGroup = (groupKey: string, title: string, fields: [string, string][], obj: Record<string, PmcAddress | null>) => (
    <div key={groupKey} className="mb-2">
      <button onClick={() => toggleSub(groupKey)} className="flex items-center gap-2 text-xs font-semibold text-gray-400 py-1.5 hover:text-gray-300">
        <span className="text-[9px]">{sub[groupKey] ? '▼' : '▶'}</span> {title}
      </button>
      {sub[groupKey] && (
        <div className="ml-2 border-l border-gray-700 pl-3">
          {fields.map(([key, desc]) => (
            <PmcAddressField
              key={key}
              label={key}
              description={desc}
              value={obj[key] ?? null}
              onChange={v => update(`pmcMap.${groupKey}.${key}`, v)}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="pt-2">
      <p className="text-[10px] text-gray-500 mb-3">PMC 주소 형식: [영역] [바이트주소] [.비트] [데이터타입]</p>
      {renderGroup('interlock', '4-1. 인터록(안전) 신호', INTERLOCK_FIELDS, pm.interlock as unknown as Record<string, PmcAddress | null>)}
      {renderGroup('status', '4-2. 상태 신호 (CNC → 웹)', STATUS_FIELDS, pm.status as unknown as Record<string, PmcAddress | null>)}
      {renderGroup('control', '4-3. 제어 신호 (웹 → CNC)', CONTROL_FIELDS, pm.control as unknown as Record<string, PmcAddress | null>)}
      {renderGroup('counters', '4-4. 카운터/데이터', COUNTER_FIELDS, pm.counters as unknown as Record<string, PmcAddress | null>)}
      {renderGroup('scheduler', '4-5. 스케줄러 전용 신호', SCHED_FIELDS, pm.scheduler as unknown as Record<string, PmcAddress | null>)}
    </div>
  );
}

// ── Section 5: Scheduler Config ─────────────────────────
function SectionSchedulerConfig({ data, update }: { data: CncTemplate; update: (path: string, v: unknown) => void }) {
  const sc = data.schedulerConfig;
  return (
    <div className="grid grid-cols-2 gap-4 pt-3">
      <TextInput label="M20 감지 주소" value={sc.m20Addr} onChange={v => update('schedulerConfig.m20Addr', v)} placeholder="R6002.4" mono />
      <NumberInput label="카운트 변수 번호" value={sc.countDisplay.countMacroNo} onChange={v => update('schedulerConfig.countDisplay.countMacroNo', v)} />
      <NumberInput label="프리셋 변수 번호" value={sc.countDisplay.presetMacroNo} onChange={v => update('schedulerConfig.countDisplay.presetMacroNo', v)} />
      <TextInput label="RESET 신호 주소" value={sc.resetAddr} onChange={v => update('schedulerConfig.resetAddr', v)} placeholder="R6103.0" mono />
      <TextInput label="원사이클 스톱 출력" value={sc.oneCycleStopAddr} onChange={v => update('schedulerConfig.oneCycleStopAddr', v)} placeholder="R0000.0" mono />
      <TextInput label="원사이클 스톱 상태" value={sc.oneCycleStopStatusAddr} onChange={v => update('schedulerConfig.oneCycleStopStatusAddr', v)} placeholder="R0000.0" mono />
      <TextInput label="MAIN HEAD 출력" value={sc.mainHeadAddr} onChange={v => update('schedulerConfig.mainHeadAddr', v)} placeholder="R0000.0" mono />
      <TextInput label="MAIN HEAD 상태" value={sc.mainHeadStatusAddr} onChange={v => update('schedulerConfig.mainHeadStatusAddr', v)} placeholder="R0000.0" mono />
      <TextInput label="SUB HEAD 출력" value={sc.subHeadAddr} onChange={v => update('schedulerConfig.subHeadAddr', v)} placeholder="R0000.0" mono />
      <TextInput label="SUB HEAD 상태" value={sc.subHeadStatusAddr} onChange={v => update('schedulerConfig.subHeadStatusAddr', v)} placeholder="R0000.0" mono />
      <TextInput label="path2 only 확인 주소" value={sc.path2OnlyConfirmAddr} onChange={v => update('schedulerConfig.path2OnlyConfirmAddr', v)} placeholder="R0000.0" mono />
      <NumberInput label="큐 최대 크기" value={sc.maxQueueSize} onChange={v => update('schedulerConfig.maxQueueSize', v)} min={1} max={100} />
    </div>
  );
}

// ── Section 6: Tool Life Config ──────────────────────────

const VAR_TYPE_OPTIONS = [
  { value: 'macro', label: '커스텀 변수 (#)', prefix: '#' },
  { value: 'pcode', label: 'P코드 변수 (#)',  prefix: '#' },
  { value: 'ddata', label: 'D데이터 (D)',      prefix: 'D' },
] as const;

function uid() { return `tl-${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }

function ToolPathTab({
  pathCfg,
  onUpdate,
}: {
  pathCfg: ToolLifePathConfig;
  onUpdate: (cfg: ToolLifePathConfig) => void;
}) {
  const cols = pathCfg.columns;
  const entries = pathCfg.entries;

  // ── Column helpers ──
  const addCol = () => onUpdate({
    ...pathCfg,
    columns: [...cols, { key: `col${cols.length + 1}`, label: 'NEW', varType: 'macro', readonly: false }],
  });
  const updateCol = (i: number, patch: Partial<ToolLifeColumn>) => {
    const next = cols.map((c, idx) => idx === i ? { ...c, ...patch } : c);
    onUpdate({ ...pathCfg, columns: next });
  };
  const removeCol = (i: number) => onUpdate({ ...pathCfg, columns: cols.filter((_, idx) => idx !== i) });

  // ── Entry helpers ──
  const addEntry = () => onUpdate({
    ...pathCfg,
    entries: [
      ...entries,
      { id: uid(), toolNo: '', isSeparator: false, varNos: Object.fromEntries(cols.map(c => [c.key, 0])) },
    ],
  });
  const addSeparator = () => onUpdate({
    ...pathCfg,
    entries: [...entries, { id: uid(), toolNo: '', isSeparator: true, varNos: {} }],
  });
  const updateEntry = (i: number, patch: Partial<ToolLifeEntry>) => {
    const next = entries.map((e, idx) => idx === i ? { ...e, ...patch } : e);
    onUpdate({ ...pathCfg, entries: next });
  };
  const updateVarNo = (entryIdx: number, colKey: string, val: number) => {
    const e = entries[entryIdx];
    const next = entries.map((en, idx) =>
      idx === entryIdx ? { ...en, varNos: { ...en.varNos, [colKey]: val } } : en,
    );
    onUpdate({ ...pathCfg, entries: next });
    void e; // suppress unused warning
  };
  const removeEntry = (i: number) => onUpdate({ ...pathCfg, entries: entries.filter((_, idx) => idx !== i) });
  const moveEntry = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= entries.length) return;
    const next = [...entries];
    [next[i], next[j]] = [next[j], next[i]];
    onUpdate({ ...pathCfg, entries: next });
  };

  return (
    <div className="space-y-4">
      {/* ── 컬럼 정의 ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-300">
            컬럼 정의
            <span className="text-gray-500 font-normal ml-1.5 text-[10px]">변수 종류·번호 구조를 먼저 정의하세요</span>
          </h4>
          <div className="flex gap-2">
            {cols.length === 0 && (
              <button
                onClick={() => onUpdate({
                  ...pathCfg,
                  columns: [
                    { key: 'preset', label: 'PRESET', varType: 'macro', readonly: false, unit: '회' },
                    { key: 'count',  label: 'COUNT',  varType: 'macro', readonly: true },
                  ],
                })}
                className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded"
              >
                기본 추가 (PRESET+COUNT)
              </button>
            )}
            <button onClick={addCol} className="text-xs text-blue-400 hover:text-blue-300">+ 컬럼 추가</button>
          </div>
        </div>
        {cols.length === 0 ? (
          <p className="text-xs text-gray-600 italic">컬럼이 없으면 공구별 변수 번호를 입력할 수 없습니다. 먼저 컬럼을 추가하세요.</p>
        ) : (
          <div className="border border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 border-b border-gray-700 text-[10px] text-gray-400">
                  <th className="px-2 py-2 text-left w-24">Key</th>
                  <th className="px-2 py-2 text-left w-28">표시명</th>
                  <th className="px-2 py-2 text-left w-36">변수 종류</th>
                  <th className="px-2 py-2 text-left w-24">데이터 폭</th>
                  <th className="px-2 py-2 text-center w-16">읽기전용</th>
                  <th className="px-2 py-2 text-left w-16">단위</th>
                  <th className="px-2 py-2 w-6" />
                </tr>
              </thead>
              <tbody>
                {cols.map((col, i) => (
                  <tr key={i} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                    <td className="px-2 py-1.5">
                      <input value={col.key} onChange={e => updateCol(i, { key: e.target.value })}
                        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white font-mono text-xs focus:border-blue-500 focus:outline-none" placeholder="preset" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={col.label} onChange={e => updateCol(i, { label: e.target.value })}
                        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none" placeholder="PRESET" />
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={col.varType} onChange={e => {
                        const vt = e.target.value as ToolLifeColumn['varType'];
                        // macro/pcode는 cnc_rdmacro → dataType 불필요, ddata만 byte/word/dword 선택
                        updateCol(i, { varType: vt, dataType: vt === 'ddata' ? (col.dataType ?? 'word') : undefined });
                      }}
                        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none">
                        {VAR_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      {col.varType === 'ddata' ? (
                        <select
                          value={col.dataType ?? 'word'}
                          onChange={e => updateCol(i, { dataType: e.target.value as ToolLifeColumn['dataType'] })}
                          className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none"
                        >
                          <option value="byte">byte (1)</option>
                          <option value="word">word (2)</option>
                          <option value="dword">dword (4)</option>
                        </select>
                      ) : (
                        <span className="text-gray-600 text-[10px] px-1">실수형</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => updateCol(i, { readonly: !col.readonly })}
                        className={`relative w-8 h-4 rounded-full transition-colors ${col.readonly ? 'bg-blue-600' : 'bg-gray-600'}`}>
                        <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${col.readonly ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={col.unit ?? ''} onChange={e => updateCol(i, { unit: e.target.value || undefined })}
                        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none" placeholder="회" />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => removeCol(i)} className="text-red-500/60 hover:text-red-400 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 공구 목록 ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-300">
            공구 목록
            <span className="text-gray-600 font-normal ml-1">({entries.filter(e => !e.isSeparator).length}개)</span>
          </h4>
          <div className="flex gap-2">
            <button onClick={addSeparator} className="text-xs text-gray-400 hover:text-gray-200 border border-gray-600 px-2 py-0.5 rounded">+ 구분선</button>
            <button onClick={addEntry} className="text-xs text-blue-400 hover:text-blue-300">+ 공구 추가</button>
          </div>
        </div>

        {cols.length === 0 ? (
          <div className="border border-dashed border-yellow-700/50 rounded-lg p-4 text-center text-yellow-600 text-xs bg-yellow-900/10">
            ⚠ 위 <span className="font-semibold">컬럼 정의</span>에서 PRESET, COUNT 등의 컬럼을 먼저 추가해야<br />공구별 변수 번호를 입력할 수 있습니다.
          </div>
        ) : entries.length === 0 ? (
          <div className="border border-dashed border-gray-700 rounded-lg p-6 text-center text-gray-600 text-xs">
            공구를 추가하세요
            <br />
            <button onClick={addEntry} className="mt-2 text-blue-400 hover:text-blue-300 underline">+ 공구 추가</button>
          </div>
        ) : (
          <div className="border border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 border-b border-gray-700 text-[10px] text-gray-400">
                  <th className="px-2 py-2 text-left w-24">공구번호</th>
                  {cols.map(c => {
                    const prefix = VAR_TYPE_OPTIONS.find(o => o.value === c.varType)?.prefix ?? '#';
                    return (
                      <th key={c.key} className="px-2 py-2 text-right">
                        {c.label} <span className="text-gray-600">({prefix})</span>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-center w-16">순서</th>
                  <th className="px-2 py-2 w-6" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  if (entry.isSeparator) {
                    return (
                      <tr key={entry.id} className="border-b border-gray-800 last:border-0 bg-gray-900/40">
                        <td colSpan={cols.length + 1} className="px-3 py-1">
                          <div className="border-t border-dashed border-gray-700 w-full" />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <button onClick={() => moveEntry(i, -1)} disabled={i === 0} className="px-1 text-gray-500 hover:text-white disabled:opacity-30">▲</button>
                            <button onClick={() => moveEntry(i, 1)} disabled={i === entries.length - 1} className="px-1 text-gray-500 hover:text-white disabled:opacity-30">▼</button>
                          </div>
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button onClick={() => removeEntry(i)} className="text-red-500/60 hover:text-red-400 text-xs">✕</button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={entry.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                      <td className="px-2 py-1.5">
                        <input
                          value={entry.toolNo}
                          onChange={e => updateEntry(i, { toolNo: e.target.value })}
                          placeholder="T0101"
                          className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white font-mono text-xs focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      {cols.map(col => (
                        <td key={col.key} className="px-2 py-1.5">
                          <input
                            type="number"
                            value={entry.varNos[col.key] ?? 0}
                            onChange={e => updateVarNo(i, col.key, Number(e.target.value))}
                            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white font-mono text-xs text-right focus:border-blue-500 focus:outline-none [appearance:textfield]"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <button onClick={() => moveEntry(i, -1)} disabled={i === 0} className="px-1 text-gray-500 hover:text-white disabled:opacity-30">▲</button>
                          <button onClick={() => moveEntry(i, 1)} disabled={i === entries.length - 1} className="px-1 text-gray-500 hover:text-white disabled:opacity-30">▼</button>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => removeEntry(i)} className="text-red-500/60 hover:text-red-400 text-xs">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-3 py-1.5 bg-gray-800/50 border-t border-gray-700 flex justify-between items-center">
              <button onClick={addEntry} className="text-xs text-blue-400 hover:text-blue-300">+ 공구 추가</button>
              <button onClick={addSeparator} className="text-xs text-gray-500 hover:text-gray-300">+ 구분선</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionToolLifeConfig({ data, update }: { data: CncTemplate; update: (path: string, v: unknown) => void }) {
  const [activePath, setActivePath] = useState<1 | 2>(1);
  const paths = data.toolLifeConfig?.paths ?? [];
  const pathCfg = paths.find(p => p.pathNo === activePath) ?? { pathNo: activePath, columns: [], entries: [] };

  const handlePathUpdate = (cfg: ToolLifePathConfig) => {
    const next = paths.filter(p => p.pathNo !== activePath);
    update('toolLifeConfig.paths', [...next, cfg].sort((a, b) => a.pathNo - b.pathNo));
  };

  return (
    <div className="pt-3 space-y-3">
      <div className="flex gap-1">
        {([1, 2] as const).map(pn => (
          <button key={pn} onClick={() => setActivePath(pn)}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${activePath === pn ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
            PATH{pn}
            <span className="ml-1.5 text-[10px] opacity-60">
              {paths.find(p => p.pathNo === pn)?.entries?.filter(e => !e.isSeparator).length ?? 0}공구
            </span>
          </button>
        ))}
      </div>
      <ToolPathTab pathCfg={pathCfg as ToolLifePathConfig} onUpdate={handlePathUpdate} />
    </div>
  );
}

// ── Section 8: PMC Messages ───────────────────────────────
function SectionPmcMessages({ data, update }: { data: CncTemplate; update: (path: string, v: unknown) => void }) {
  const entries: PmcMessageEntry[] = data.pmcMessages ?? [];

  const addEntry = () => {
    const newEntry: PmcMessageEntry = {
      id: `msg-${Date.now()}`,
      pmcAddr: '',
      message: '',
    };
    update('pmcMessages', [...entries, newEntry]);
  };

  const updateEntry = (id: string, field: keyof PmcMessageEntry, value: string) => {
    update('pmcMessages', entries.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const removeEntry = (id: string) => {
    update('pmcMessages', entries.filter(e => e.id !== id));
  };

  return (
    <div className="pt-3 space-y-2">
      <p className="text-[11px] text-gray-400">
        PMC 비트가 1(ON)이 되면 해당 메시지를 알람/메시지 영역에 표시합니다.
      </p>
      {entries.length === 0 && (
        <div className="text-[11px] text-gray-600 py-2">등록된 메시지 없음</div>
      )}
      {entries.map((entry, idx) => (
        <div key={entry.id} className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1.5">
          <span className="text-[10px] text-gray-500 w-5 text-right shrink-0">{idx + 1}</span>
          <input
            type="text"
            value={entry.pmcAddr}
            onChange={e => updateEntry(entry.id, 'pmcAddr', e.target.value)}
            placeholder="PMC 주소 (예: A209.5)"
            className="w-28 shrink-0 bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            value={entry.message}
            onChange={e => updateEntry(entry.id, 'message', e.target.value)}
            placeholder="표시할 메시지 내용"
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => removeEntry(entry.id)}
            className="shrink-0 text-gray-500 hover:text-red-400 text-xs px-1 transition-colors"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={addEntry}
        className="mt-1 px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded border border-gray-600 transition-colors"
      >
        + 메시지 추가
      </button>
    </div>
  );
}

// ── Section 7: Capabilities ──────────────────────────────
function SectionCapabilities({ data, update }: { data: CncTemplate; update: (path: string, v: unknown) => void }) {
  const cap = data.capabilities;
  const flags: [string, string, string][] = [
    ['monitoring', '실시간 모니터링', '장비 상태 실시간 표시'],
    ['scheduler', '스케줄러', 'DNC/Memory 순차실행'],
    ['fileTransfer', '파일 전송', 'NC 프로그램 전송'],
    ['alarmHistory', '알람 이력', '알람 이력 관리'],
    ['remoteControl', '원격 제어', '가상 조작반 (구현 시 활성화)'],
    ['hasSubSpindle', '부축 장착', '서브 스핀들'],
    ['hasCAxis', 'C축', 'C축 인덱싱'],
    ['hasYAxis', 'Y축', 'Y축 장착'],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 pt-3">
      {flags.map(([key, label, desc]) => (
        <Toggle key={key} label={label} description={desc}
          value={(cap as unknown as Record<string, boolean>)[key] ?? false}
          onChange={v => update(`capabilities.${key}`, v)} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Main Page Component
// ═══════════════════════════════════════════════════════════

export function TemplateEditor() {
  const user = useAuthStore(s => s.user);
  const canAccess = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';

  const {
    templates, selectedTemplateId,
    loadTemplates, selectTemplate,
    createTemplate, duplicateTemplate, deleteTemplate,
    updateTemplate, importFromJsonc, exportToJsonc,
  } = useTemplateStore();

  const selectedTemplate = useSelectedTemplate();
  const [formData, setFormData] = useState<CncTemplate | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    metadata: true,
    systemInfo: false,
    axisConfig: false,
    pmcMap: false,
    schedulerConfig: false,
    toolLifeConfig: false,
    pmcMessages: false,
    capabilities: false,
  });

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    if (selectedTemplate) {
      setFormData(structuredClone(selectedTemplate));
      setIsDirty(false);
      setDeleteConfirm(false);
    } else {
      setFormData(null);
    }
  }, [selectedTemplate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = useCallback((path: string, value: unknown) => {
    setFormData(prev => {
      if (!prev) return prev;
      const updated = structuredClone(prev);
      setNestedValue(updated as unknown as Record<string, unknown>, path, value);
      return updated;
    });
    setIsDirty(true);
  }, []);

  const handleSave = () => {
    if (!formData) return;
    updateTemplate(formData.id, formData);
    setIsDirty(false);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jsonc,.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          importFromJsonc(reader.result as string);
        } catch (err) {
          alert('JSONC 파싱 실패: ' + (err instanceof Error ? err.message : String(err)));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleExport = () => {
    if (!selectedTemplateId) return;
    const json = exportToJsonc(selectedTemplateId);
    if (!json) return;
    const tpl = templates.find(t => t.id === selectedTemplateId);
    const filename = (tpl?.templateId || 'template') + '.jsonc';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = () => {
    if (!selectedTemplateId) return;
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    deleteTemplate(selectedTemplateId);
    setDeleteConfirm(false);
  };

  const toggleSection = (key: string) => setExpanded(p => ({ ...p, [key]: !p[key] }));

  // ── Access Guard ──
  if (!canAccess) {
    return (
      <div className="p-6">
        <div className="bg-red-900/20 text-red-400 p-4 rounded-lg text-sm">
          HQ 엔지니어/ADMIN 전용 페이지입니다. 접근 권한이 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-gray-900 text-gray-100">
      {/* ── Left Panel: Template List ── */}
      <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-700">
          <h2 className="text-sm font-bold text-gray-200">Template Editor</h2>
          <p className="text-[10px] text-gray-500 mt-0.5">장비 템플릿 관리</p>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {templates.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => {
                if (isDirty && !confirm('저장하지 않은 변경사항이 있습니다. 전환하시겠습니까?')) return;
                selectTemplate(tpl.id);
              }}
              className={`w-full text-left p-2 rounded-lg text-xs transition-colors ${
                tpl.id === selectedTemplateId
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="font-semibold truncate">{tpl.name || '(이름 없음)'}</div>
              <div className="text-[10px] opacity-70 font-mono truncate">{tpl.templateId || '(ID 미설정)'}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-1.5 h-1.5 rounded-full ${tpl.isActive ? 'bg-green-400' : 'bg-gray-500'}`} />
                <span className="text-[10px] opacity-60">v{tpl.version}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="p-2 border-t border-gray-700 space-y-1">
          <button
            onClick={() => createTemplate()}
            className="w-full px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >+ 신규 템플릿</button>
          <label className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 cursor-pointer">
            <span>↑</span> 템플릿 불러오기
            <input
              type="file"
              accept=".jsonc,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try { importFromJsonc(reader.result as string); }
                  catch (err) { alert('파싱 실패: ' + (err instanceof Error ? err.message : String(err))); }
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
          </label>
          <div className="flex gap-1">
            <button
              onClick={() => selectedTemplateId && duplicateTemplate(selectedTemplateId)}
              disabled={!selectedTemplateId}
              className="flex-1 px-2 py-1.5 text-xs bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-40"
            >복제</button>
            <button
              onClick={handleDelete}
              disabled={!selectedTemplateId}
              className={`flex-1 px-2 py-1.5 text-xs rounded-lg disabled:opacity-40 ${
                deleteConfirm ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >{deleteConfirm ? '확인 삭제' : '삭제'}</button>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Form Editor ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-850 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-200">{formData?.name || '템플릿 선택'}</span>
            {isDirty && <span className="w-2 h-2 rounded-full bg-orange-400" title="저장하지 않은 변경사항" />}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleImport} className="px-3 py-1.5 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600">Import</button>
            <button onClick={handleExport} disabled={!selectedTemplateId} className="px-3 py-1.5 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-40">Export</button>
            <button onClick={handleSave} disabled={!isDirty} className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              저장
            </button>
          </div>
        </div>

        {/* Form sections */}
        {formData ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-1" style={{ scrollbarGutter: 'stable' }}>
            <CollapsibleSection title="1. 메타데이터" expanded={expanded.metadata} onToggle={() => toggleSection('metadata')}>
              <SectionMetadata data={formData} update={updateField} />
            </CollapsibleSection>

            <CollapsibleSection title="2. 시스템 정보" expanded={expanded.systemInfo} onToggle={() => toggleSection('systemInfo')}>
              <SectionSystemInfo data={formData} update={updateField} />
            </CollapsibleSection>

            <CollapsibleSection title="3. 축 구성 (Axis Config)" expanded={expanded.axisConfig} onToggle={() => toggleSection('axisConfig')}>
              <SectionAxisConfig data={formData} update={updateField} />
            </CollapsibleSection>

            <CollapsibleSection title="4. PMC 주소 매핑" expanded={expanded.pmcMap} onToggle={() => toggleSection('pmcMap')}>
              <SectionPmcMap data={formData} update={updateField} />
            </CollapsibleSection>

            <CollapsibleSection title="5. 스케줄러 설정" expanded={expanded.schedulerConfig} onToggle={() => toggleSection('schedulerConfig')}>
              <SectionSchedulerConfig data={formData} update={updateField} />
            </CollapsibleSection>

            <CollapsibleSection title="6. 툴라이프 설정" expanded={expanded.toolLifeConfig} onToggle={() => toggleSection('toolLifeConfig')}>
              <SectionToolLifeConfig data={formData} update={updateField} />
            </CollapsibleSection>

            <CollapsibleSection title="7. PMC 메시지 등록" expanded={expanded.pmcMessages} onToggle={() => toggleSection('pmcMessages')}>
              <SectionPmcMessages data={formData} update={updateField} />
            </CollapsibleSection>

            <CollapsibleSection title="8. 기능 플래그 (Capabilities)" expanded={expanded.capabilities} onToggle={() => toggleSection('capabilities')}>
              <SectionCapabilities data={formData} update={updateField} />
            </CollapsibleSection>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            좌측에서 템플릿을 선택하거나 신규 생성하세요
          </div>
        )}
      </div>
    </div>
  );
}

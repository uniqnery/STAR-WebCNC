// SchedulerConfig - 스케줄러 설정 관리자 페이지 (/admin/scheduler-config)
// 실행 흐름도 + 각 단계별 PMC 주소 / 타이머 설정 UI

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTemplateStore, type SchedulerConfig } from '../stores/templateStore';

// ── 빈 기본값 ───────────────────────────────────────────
const EMPTY: SchedulerConfig = {
  cycleStartAddr: '',
  m20Addr: '',
  countDisplay: { countMacroNo: 900, countVarType: 'macro' as const, presetMacroNo: 10000, presetVarType: 'pcode' as const, cycleTimeAddr: 'D96', cycleTimeMultiplier: 4 },
  resetAddr: '',
  oneCycleStopAddr: '',
  oneCycleStopStatusAddr: '',
  mainHeadAddr: '',
  mainHeadStatusAddr: '',
  subHeadAddr: '',
  subHeadStatusAddr: '',
  path2OnlyConfirmAddr: '',
  path2OnlyConfirmDelayMs: 500,
  path2OnlyTimeoutMs: 4000,
  path2OnlyTimeoutAction: 'error',
  maxQueueSize: 15,
};

// ── 작은 텍스트 인풋 ─────────────────────────────────────
function AddrInput({
  label,
  value,
  onChange,
  placeholder = 'R0000.0',
  optional = true,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  optional?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
        {label}
        {optional && <span className="ml-0.5 text-gray-500">(선택)</span>}
        {!optional && <span className="ml-0.5 text-red-400">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className="w-28 px-2 py-1 text-xs font-mono border border-gray-600 rounded
                   bg-gray-700 text-gray-100
                   focus:outline-none focus:ring-1 focus:ring-blue-500
                   disabled:opacity-50 read-only:bg-gray-800 read-only:cursor-not-allowed"
      />
    </div>
  );
}

function NumInput({
  label,
  value,
  onChange,
  unit = '',
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 whitespace-nowrap">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 px-2 py-1 text-xs font-mono border border-gray-600 rounded
                   bg-gray-700 text-gray-100
                   focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      {unit && <span className="text-xs text-gray-400">{unit}</span>}
    </div>
  );
}

// ── 흐름도 연결 화살표 ──────────────────────────────────
function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-0.5">
      <div className="w-px h-4 bg-gray-600" />
      {label && (
        <span className="text-xs text-red-400 bg-red-900/20 px-1.5 py-0.5 rounded border border-red-800">
          {label}
        </span>
      )}
      <div className="flex flex-col items-center">
        <div className="w-px h-3 bg-gray-600" />
        <svg width="12" height="8" className="text-gray-500">
          <path d="M6 8 L0 0 L12 0 Z" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

// ── 흐름도 단계 카드 ──────────────────────────────────────
function FlowStep({
  index,
  title,
  subtitle,
  color = 'blue',
  children,
  badge,
}: {
  index: number;
  title: string;
  subtitle?: string;
  color?: 'blue' | 'green' | 'yellow' | 'purple' | 'gray' | 'red';
  children?: React.ReactNode;
  badge?: string;
}) {
  const colorMap = {
    blue:   'border-blue-700  bg-blue-900/20',
    green:  'border-green-700 bg-green-900/20',
    yellow: 'border-yellow-700 bg-yellow-900/20',
    purple: 'border-purple-700 bg-purple-900/20',
    gray:   'border-gray-600 bg-gray-800',
    red:    'border-red-700 bg-red-900/20',
  };
  const numColorMap = {
    blue:   'bg-blue-500',
    green:  'bg-green-500',
    yellow: 'bg-yellow-500',
    purple: 'bg-purple-500',
    gray:   'bg-gray-400',
    red:    'bg-red-500',
  };
  return (
    <div className={`rounded-lg border ${colorMap[color]} p-3`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-7 h-7 rounded-full ${numColorMap[color]} flex items-center justify-center text-white text-sm font-bold`}>
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-100">{title}</span>
            {badge && (
              <span className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          {children && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{children}</div>}
        </div>
      </div>
    </div>
  );
}

// ── 섹션 구분선 ─────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mt-6 mb-2 px-1">
      {children}
    </h3>
  );
}

// ── Main Component ───────────────────────────────────────
export function SchedulerConfig() {
  const user = useAuthStore((s) => s.user);
  const { templates, selectedTemplateId, loadTemplates, selectTemplate, updateTemplate, importFromJsonc } = useTemplateStore();

  const [cfg, setCfg] = useState<SchedulerConfig>(EMPTY);
  const [dirty, setDirty] = useState(false);

  const canEdit = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (tpl?.schedulerConfig) {
      setCfg({ ...EMPTY, ...tpl.schedulerConfig });
      setDirty(false);
    }
  }, [selectedTemplateId, templates]);

  const patch = (partial: Partial<SchedulerConfig>) => {
    setCfg((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  };

  const handleSave = () => {
    if (!selectedTemplateId) return;
    updateTemplate(selectedTemplateId, { schedulerConfig: cfg });
    setDirty(false);
  };

  const selectedTpl = templates.find((t) => t.id === selectedTemplateId);

  // ── 렌더 ──────────────────────────────────────────────
  return (
    <div className="flex h-full bg-gray-900 text-white">

      {/* ── Left Sidebar: Template List ── */}
      <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-700">
          <h2 className="text-sm font-bold text-gray-200">스케줄러 설정</h2>
          <p className="text-[10px] text-gray-500 mt-0.5">템플릿별 실행 시퀀스 주소 설정</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {templates.map((tpl) => {
            const sc = tpl.schedulerConfig;
            const configured = [sc?.m20Addr, sc?.oneCycleStopAddr, sc?.mainHeadAddr].filter(Boolean).length;
            return (
              <button
                key={tpl.id}
                onClick={() => {
                  if (dirty && !confirm('저장하지 않은 변경사항이 있습니다. 전환하시겠습니까?')) return;
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
                  <span className="text-[10px] opacity-60">주소 {configured}개 설정</span>
                </div>
              </button>
            );
          })}
          {templates.length === 0 && (
            <div className="p-3 text-center text-gray-600 text-xs">템플릿 없음</div>
          )}
        </div>

        <div className="p-2 border-t border-gray-700">
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
        </div>
      </div>

      {/* ── Right: Editor ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 flex-shrink-0">
          <div>
            <span className="text-sm font-semibold text-gray-200">
              {selectedTpl?.name || '(템플릿 선택)'}
            </span>
            <p className="text-[10px] text-gray-500 mt-0.5">
              실행 시퀀스 각 단계의 PMC 주소와 타이머를 설정합니다
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {dirty && <span className="text-xs text-yellow-400">* 변경사항 있음</span>}
            {canEdit && (
              <button
                onClick={handleSave}
                disabled={!dirty || !selectedTemplateId}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                저장
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
        {!selectedTemplateId ? (
          <p className="text-center text-gray-500 text-sm py-16">
            왼쪽에서 템플릿을 선택하면 설정을 편집할 수 있습니다.
          </p>
        ) : (
        <>
          {/* ─────────────────────────────────────────────────
              섹션 1: M20 감지 + 카운트 (항상 동작)
          ───────────────────────────────────────────────── */}
          <SectionTitle>M20 감지 및 카운트 동기화</SectionTitle>
          <div className="p-3 rounded-lg border border-orange-700 bg-orange-900/20">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-bold">M</div>
              <div className="flex-1">
                <div className="font-semibold text-sm text-gray-100">M20 완료 신호 감지</div>
                <p className="text-xs text-gray-400 mt-0.5 mb-2">
                  PMC bit polling으로 M20 신호를 감지합니다. <strong>빈값이면 스케줄러 비활성화됩니다.</strong>
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <AddrInput
                    label="M20 완료 신호"
                    value={cfg.m20Addr}
                    onChange={(v) => patch({ m20Addr: v })}
                    optional={false}
                  />
                  {/* COUNT 변수 */}
                  <NumInput
                    label="카운트 변수 번호"
                    value={cfg.countDisplay.countMacroNo}
                    onChange={(v) => patch({ countDisplay: { ...cfg.countDisplay, countMacroNo: v } })}
                    min={1}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">카운트 타입</span>
                    <select
                      value={cfg.countDisplay.countVarType}
                      onChange={(e) => patch({ countDisplay: { ...cfg.countDisplay, countVarType: e.target.value as 'macro' | 'pcode' } })}
                      className="px-2 py-1 text-xs border border-gray-600 rounded
                                 bg-gray-700 text-gray-100
                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="macro">커스텀 매크로 (#)</option>
                      <option value="pcode">P코드 변수 (P)</option>
                    </select>
                  </div>
                  {/* PRESET 변수 */}
                  <NumInput
                    label="프리셋 변수 번호"
                    value={cfg.countDisplay.presetMacroNo}
                    onChange={(v) => patch({ countDisplay: { ...cfg.countDisplay, presetMacroNo: v } })}
                    min={1}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">프리셋 타입</span>
                    <select
                      value={cfg.countDisplay.presetVarType}
                      onChange={(e) => patch({ countDisplay: { ...cfg.countDisplay, presetVarType: e.target.value as 'macro' | 'pcode' } })}
                      className="px-2 py-1 text-xs border border-gray-600 rounded
                                 bg-gray-700 text-gray-100
                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="macro">커스텀 매크로 (#)</option>
                      <option value="pcode">P코드 변수 (P)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ─────────────────────────────────────────────────
              섹션 2: 행 시작 실행 시퀀스 흐름도
          ───────────────────────────────────────────────── */}
          <SectionTitle>행 시작 실행 시퀀스</SectionTitle>

          <FlowStep
            index={1}
            title="인터록 확인"
            color="gray"
            subtitle="스케줄러 탑바 인터록 pills 조건을 모두 만족해야 진행됩니다."
          >
            <Link
              to="/admin/interlocks"
              className="text-xs text-blue-500 hover:text-blue-700 underline"
            >
              인터록 편집기 →
            </Link>
          </FlowStep>

          <FlowArrow label="실패 → SCHEDULER_ERROR" />

          <FlowStep
            index={2}
            title="COUNT > PRESET 검사"
            color="gray"
            subtitle="현재 count가 preset 초과 시 PAUSED 전환. 사용자가 값 수정 후 RESUME."
          />

          <FlowArrow label="초과 → PAUSED" />

          <FlowStep
            index={3}
            title="Control Lock 확인"
            color="gray"
            subtitle="Redis control:lock:{machineId} 키 검증. 미보유 시 SCHEDULER_ERROR."
          />

          <FlowArrow />

          <FlowStep
            index={4}
            title="프로그램 번호 변경"
            color="blue"
            badge="memory / DNC 모드"
            subtitle="memory 모드: cnc_search(programNo). DNC 모드: 파일 존재 확인."
          />

          <FlowArrow />

          <FlowStep
            index={5}
            title="프로그램 선두 복귀"
            color="blue"
            badge="3단계 Fallback"
            subtitle="1차 cnc_rewind → 2차 RESET 신호 → 3차 cnc_search 재실행"
          >
            <AddrInput
              label="RESET 신호 (2차)"
              value={cfg.resetAddr}
              onChange={(v) => patch({ resetAddr: v })}
            />
          </FlowStep>

          <FlowArrow />

          <FlowStep
            index={6}
            title="HEAD 상태 확인 및 ON"
            color="green"
            subtitle="OFF 상태이면 ON 신호 입력. 상태 주소로 현재 상태를 읽어 중복 토글 방지."
          >
            <AddrInput
              label="MAIN HEAD 출력"
              value={cfg.mainHeadAddr}
              onChange={(v) => patch({ mainHeadAddr: v })}
            />
            <AddrInput
              label="MAIN HEAD 상태"
              value={cfg.mainHeadStatusAddr}
              onChange={(v) => patch({ mainHeadStatusAddr: v })}
            />
            <AddrInput
              label="SUB HEAD 출력"
              value={cfg.subHeadAddr}
              onChange={(v) => patch({ subHeadAddr: v })}
            />
            <AddrInput
              label="SUB HEAD 상태"
              value={cfg.subHeadStatusAddr}
              onChange={(v) => patch({ subHeadStatusAddr: v })}
            />
          </FlowStep>

          <FlowArrow />

          <FlowStep
            index={7}
            title="원사이클 스톱 OFF"
            color="yellow"
            subtitle="ON 상태이면 OFF 신호 입력. 상태 주소로 현재 상태를 읽어 중복 토글 방지."
          >
            <AddrInput
              label="원사이클 스톱 출력"
              value={cfg.oneCycleStopAddr}
              onChange={(v) => patch({ oneCycleStopAddr: v })}
            />
            <AddrInput
              label="원사이클 스톱 상태"
              value={cfg.oneCycleStopStatusAddr}
              onChange={(v) => patch({ oneCycleStopStatusAddr: v })}
            />
          </FlowStep>

          <FlowArrow />

          <FlowStep
            index={8}
            title="skipFirstM20 초기화"
            color="gray"
            subtitle="프로그램 선두의 M20은 카운트에서 제외. Agent 내부 상태 초기화 (설정 없음)."
          />

          <FlowArrow />

          <FlowStep
            index={9}
            title="사이클 스타트"
            color="green"
            subtitle="지정된 PMC 주소에 200ms 펄스 2회 출력 (3초 간격). 필수 항목 — 미설정 시 START 거부."
          >
            <AddrInput
              label="사이클 스타트 출력"
              value={cfg.cycleStartAddr}
              onChange={(v) => patch({ cycleStartAddr: v })}
              placeholder="R6105.4"
              optional={false}
            />
            {!cfg.cycleStartAddr && (
              <span className="text-xs text-red-400">미설정 시 스케줄러 START가 거부됩니다.</span>
            )}
          </FlowStep>

          {/* ─────────────────────────────────────────────────
              섹션 3: 사이클 중 시퀀스
          ───────────────────────────────────────────────── */}
          <SectionTitle>사이클 중 처리</SectionTitle>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* preset-1 → 원사이클 스톱 ON */}
            <div className="rounded-lg border border-yellow-700 bg-yellow-900/20 p-3">
              <div className="text-sm font-semibold text-gray-100 mb-1">
                count = preset - 1 → 원사이클 스톱 ON
              </div>
              <p className="text-xs text-gray-400">
                마지막 1사이클 실행 후 CNC가 원사이클 스톱 상태로 자동 정지됩니다.<br />
                사용 주소는 위 단계 7의 설정과 동일합니다.
              </p>
            </div>

            {/* 인터록 불만족 → 원사이클 스톱 ON */}
            <div className="rounded-lg border border-red-700 bg-red-900/20 p-3">
              <div className="text-sm font-semibold text-gray-100 mb-1">
                인터록 불만족 → 원사이클 스톱 ON
              </div>
              <p className="text-xs text-gray-400">
                실행 중 인터록 조건이 불만족되면 원사이클 스톱 ON → 현재 사이클 완료 후 PAUSED.
              </p>
            </div>
          </div>

          {/* ─────────────────────────────────────────────────
              섹션 4: path2 only 시퀀스
          ───────────────────────────────────────────────── */}
          <SectionTitle>Path2 Only 시퀀스 (행 완료 후 추가 실행)</SectionTitle>

          <div className="rounded-lg border border-purple-700 bg-purple-900/20 p-3">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-bold">P2</div>
              <div className="flex-1">
                <div className="font-semibold text-sm text-gray-100">
                  path2 only 확인 메시지
                </div>
                <p className="text-xs text-gray-400 mt-0.5 mb-3">
                  행에 subProgramNo가 있고 확인 메시지 주소가 설정된 경우, 행 완료 후 path2를 1사이클 추가 실행합니다.<br />
                  <strong>확인 메시지 주소가 빈값이면 path2 only 시퀀스 전체 스킵됩니다.</strong>
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <AddrInput
                    label="확인 메시지 주소"
                    value={cfg.path2OnlyConfirmAddr}
                    onChange={(v) => patch({ path2OnlyConfirmAddr: v })}
                  />
                  <NumInput
                    label="사이클 스타트 지연"
                    value={cfg.path2OnlyConfirmDelayMs}
                    onChange={(v) => patch({ path2OnlyConfirmDelayMs: v })}
                    unit="ms"
                    min={0}
                  />
                  <NumInput
                    label="감지 대기 timeout"
                    value={cfg.path2OnlyTimeoutMs}
                    onChange={(v) => patch({ path2OnlyTimeoutMs: v })}
                    unit="ms"
                    min={0}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 whitespace-nowrap">timeout 동작</span>
                    <select
                      value={cfg.path2OnlyTimeoutAction}
                      onChange={(e) => patch({ path2OnlyTimeoutAction: e.target.value as 'error' | 'skip' })}
                      className="px-2 py-1 text-xs border border-gray-600 rounded
                                 bg-gray-700 text-gray-100
                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="error">error (행 CANCELLED)</option>
                      <option value="skip">skip (시퀀스 스킵)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ─────────────────────────────────────────────────
              섹션 5: 큐 설정
          ───────────────────────────────────────────────── */}
          <SectionTitle>큐 설정</SectionTitle>

          <div className="rounded-lg border border-gray-700 bg-gray-800 p-3">
            <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
              <NumInput
                label="최대 행 수"
                value={cfg.maxQueueSize}
                onChange={(v) => patch({ maxQueueSize: v })}
                min={1}
              />
              <span className="text-xs text-gray-400">큐에 등록할 수 있는 최대 행 수</span>
            </div>
          </div>

          {/* ─────────────────────────────────────────────────
              설정 요약 테이블
          ───────────────────────────────────────────────── */}
          <SectionTitle>설정 요약</SectionTitle>

          <div className="rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-700">
                  <th className="text-left px-3 py-2 text-gray-300 font-medium w-1/3">항목</th>
                  <th className="text-left px-3 py-2 text-gray-300 font-medium w-1/3">주소 / 값</th>
                  <th className="text-left px-3 py-2 text-gray-300 font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {[
                  { label: '사이클 스타트 출력',        value: cfg.cycleStartAddr,          required: true  },
                  { label: 'M20 완료 신호',           value: cfg.m20Addr,                 required: true  },
                  { label: '카운트 변수',     value: `${cfg.countDisplay.countVarType === 'pcode' ? 'P' : '#'}${cfg.countDisplay.countMacroNo}`,   required: false },
                  { label: '프리셋 변수',     value: `${cfg.countDisplay.presetVarType === 'pcode' ? 'P' : '#'}${cfg.countDisplay.presetMacroNo}`, required: false },
                  { label: 'RESET 신호 (선두복귀 2차)', value: cfg.resetAddr,               required: false },
                  { label: '원사이클 스톱 출력',         value: cfg.oneCycleStopAddr,        required: false },
                  { label: '원사이클 스톱 상태',         value: cfg.oneCycleStopStatusAddr,  required: false },
                  { label: 'MAIN HEAD 출력',            value: cfg.mainHeadAddr,            required: false },
                  { label: 'MAIN HEAD 상태',            value: cfg.mainHeadStatusAddr,      required: false },
                  { label: 'SUB HEAD 출력',             value: cfg.subHeadAddr,             required: false },
                  { label: 'SUB HEAD 상태',             value: cfg.subHeadStatusAddr,       required: false },
                  { label: 'path2 only 확인 주소',      value: cfg.path2OnlyConfirmAddr,    required: false },
                  { label: '최대 큐 행 수',              value: String(cfg.maxQueueSize),    required: false },
                ].map((row) => (
                  <tr key={row.label} className="hover:bg-gray-750">
                    <td className="px-3 py-1.5 text-gray-300">{row.label}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-100">
                      {row.value || <span className="text-gray-400 italic">미설정</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      {row.required && !row.value ? (
                        <span className="text-red-500 font-medium">필수 — 스케줄러 비활성화</span>
                      ) : row.required && row.value ? (
                        <span className="text-green-400">설정됨</span>
                      ) : !row.value ? (
                        <span className="text-gray-400">선택 스킵</span>
                      ) : (
                        <span className="text-green-400">설정됨</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
        )}
        </div>
      </div>
    </div>
  );
}

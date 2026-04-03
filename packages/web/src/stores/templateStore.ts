// Template Store - 장비 템플릿 관리 (HQ_ENGINEER/ADMIN 전용)

import { create } from 'zustand';
import { templateApi } from '../lib/api';

// ── PMC 주소 (공통 타입) ──────────────────────────────────
export interface PmcAddress {
  type: 'R' | 'D' | 'E' | 'G' | 'Y' | 'X' | 'F' | 'K' | 'A' | 'C' | 'T';
  address: number;
  bit: number;
  dataType: 'bit' | 'byte' | 'word' | 'dword';
}

// ── Section 2: System Info ────────────────────────────────
export interface SystemInfo {
  cncType: string;
  seriesName: string;
  modelName: string;
  maxPaths: number;
  maxAxes: number; // 0=자동감지, >0=상한 캡
  supportedOptions: string[];
  coordinateDecimalPlaces: number; // IS-B=3(0.001mm), IS-C=4(0.0001mm)
}

// ── Section 3: Axis Config ────────────────────────────────
export interface PathAxisConfig {
  axes: string[] | null;
  spindleName: string | null;
  toolPrefix: string | null;
}

export interface AxisConfig {
  path1: PathAxisConfig;
  path2: PathAxisConfig;
  path3: PathAxisConfig;
}

// ── Section 4: PMC Map ────────────────────────────────────
export interface PmcInterlock {
  doorClosed: PmcAddress | null;
  chuckClamped: PmcAddress | null;
  spindleStopped: PmcAddress | null;
  coolantLevel: PmcAddress | null;
}

export interface PmcStatus {
  operationMode: PmcAddress | null;
  cycleRunning: PmcAddress | null;
  alarmActive: PmcAddress | null;
  emergencyStop: PmcAddress | null;
  programEnd: PmcAddress | null;
}

export interface PmcControl {
  cycleStart: PmcAddress | null;
  feedHold: PmcAddress | null;
  singleBlock: PmcAddress | null;
  reset: PmcAddress | null;
}

export interface PmcCounters {
  partCount: PmcAddress | null;
  targetCount: PmcAddress | null;
  cycleTime: PmcAddress | null;
}

export interface PmcSchedulerSignals {
  loadable: PmcAddress | null;
  dataReady: PmcAddress | null;
  m20Complete: PmcAddress | null;
}

export interface PmcMap {
  interlock: PmcInterlock;
  status: PmcStatus;
  control: PmcControl;
  counters: PmcCounters;
  scheduler: PmcSchedulerSignals;
}

// ── Section 5: Virtual Panel ──────────────────────────────
export interface VirtualPanelKey {
  keyId: string;
  displayName: string;
  keyType: 'momentary' | 'toggle' | 'selector';
  pmcOutput: PmcAddress | null;
  pmcFeedback: PmcAddress | null;
  requiresInterlock: boolean;
  safetyLevel: 'normal' | 'caution' | 'critical';
}

export interface OverrideConfig {
  pmcAddress: PmcAddress | null;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export interface VirtualPanel {
  modeKeys: Record<string, VirtualPanelKey | null>;
  controlKeys: Record<string, VirtualPanelKey | null>;
  toggleKeys: Record<string, VirtualPanelKey | null>;
  overrides: {
    feedRate: OverrideConfig | null;
    spindleRate: OverrideConfig | null;
  };
}

// ── Section 8: Scheduler Config ───────────────────────────
export interface SchedulerConfig {
  // ── 사이클 스타트 출력 ──────────────────────────────────
  cycleStartAddr: string;            // 사이클 스타트 출력 주소. 빈값 = pmcMap.control.cycleStart fallback

  // ── M20 감지 (필수) ──────────────────────────────────────
  m20Addr: string;                   // PMC bit polling 주소 (예: "R6002.4"). 빈값 = 스케줄러 비활성화

  // ── 카운트 동기화 ────────────────────────────────────────
  countDisplay: {
    // count: 현재 생산 수량을 NC에서 읽는 변수
    countMacroNo: number;            // 카운트 변수 번호 (기본 #900)
    countVarType: 'macro' | 'pcode'; // macro: 커스텀 매크로(#xxx), pcode: P코드(cnc_rdpmacro)
    // preset: 목표 수량을 NC에서 읽는 변수
    presetMacroNo: number;           // 프리셋 변수 번호 (기본 #10000)
    presetVarType: 'macro' | 'pcode';
    // cycle time: PMC D 어드레스 기반
    cycleTimeAddr: string;           // PMC 주소 (예: "D96"), 빈값이면 수집 안함
    cycleTimeMultiplier: number;     // 래더 주기 → ms 배수 (파라미터 No.11930: 4 또는 8)
  };

  // ── 프로그램 선두 복귀 ───────────────────────────────────
  resetAddr: string;                 // 2차 fallback RESET 신호 주소. 빈값 = 2차 스킵

  // ── 원사이클 스톱 (출력/상태 분리) ──────────────────────
  oneCycleStopAddr: string;          // 출력 (쓰기) — ON/OFF 토글 신호
  oneCycleStopStatusAddr: string;    // 상태 (읽기) — 현재 ON/OFF 확인. 빈값 = 상태 확인 스킵

  // ── HEAD 제어 (출력/상태 분리) ───────────────────────────
  mainHeadAddr: string;              // MAIN HEAD 출력 (쓰기). 빈값 = 스킵
  mainHeadStatusAddr: string;        // MAIN HEAD 상태 (읽기)
  subHeadAddr: string;               // SUB HEAD 출력 (쓰기). 빈값 = 스킵
  subHeadStatusAddr: string;         // SUB HEAD 상태 (읽기)

  // ── path2 only 확인 메시지 ───────────────────────────────
  path2OnlyConfirmAddr: string;      // 확인 메시지 PMC 주소. 빈값 = path2 only 전체 스킵
  path2OnlyConfirmDelayMs: number;   // 감지 후 사이클 스타트까지 대기 (기본 500ms)
  path2OnlyTimeoutMs: number;        // 확인 메시지 감지 timeout (기본 4000ms)
  path2OnlyTimeoutAction: 'error' | 'skip'; // timeout 시 동작

  // ── 큐 설정 ─────────────────────────────────────────────
  maxQueueSize: number;              // 큐 최대 행 수 (기본 15)
}

// ── Panel Layout (조작반 커스텀 레이아웃) ────────────────
export type PanelKeyColor = 'green' | 'yellow' | 'red' | 'blue' | 'gray';
export type PanelKeySize = 'small' | 'normal' | 'wide' | 'large';

export interface PanelKey {
  id: string;
  label: string;
  hasLamp: boolean;
  color: PanelKeyColor;
  size: PanelKeySize;
  reqAddr: string;       // PMC Write 주소 (Y0030.0 등)
  lampAddr: string;      // PMC Read 주소 (R6004.0 등), 빈값=없음
  timing: {
    longPressMs: number;
    holdMs: number;
    timeoutMs: number;
  };
}

export type GroupNameAlign = 'left' | 'center' | 'right';
export type GroupNameSize = 'xs' | 'sm' | 'base';
export type GroupNameWeight = 'normal' | 'semibold' | 'bold';
export type GroupNameColor = 'gray' | 'white' | 'blue' | 'green' | 'yellow' | 'red';

export interface PanelGroup {
  id: string;
  name: string;          // 사용자 정의 그룹명
  keys: PanelKey[];      // 순서 = 렌더링 순서
  sameRowAsPrev?: boolean; // true면 이전 그룹과 같은 줄에 배치
  nameAlign?: GroupNameAlign;
  nameFontSize?: GroupNameSize;
  nameFontWeight?: GroupNameWeight;
  nameColor?: GroupNameColor;
}

// ── Section 10: Offset / Counter / Tool-Life Config ───────

export interface OffsetConfig {
  toolCount: number;   // 최대 공구 수 (기본 64)
  pageSize: number;    // 페이지당 표시 수 (기본 16)
}

export interface CounterField {
  key: string;
  label: string;
  varType: 'macro' | 'pcode';
  varNo: number;
  readonly: boolean;
  unit?: string;
}

export interface CounterConfig {
  fields: CounterField[];
}

export interface ToolLifeColumn {
  key: string;
  label: string;
  varType: 'macro' | 'pcode' | 'ddata'; // 변수 종류: 매크로(#), P코드(P), D데이터(D)
  dataType?: 'byte' | 'word' | 'dword';  // pcode/ddata일 때 PMC 데이터 폭 (macro는 항상 실수)
  readonly: boolean;
  unit?: string;
}

export interface ToolLifeEntry {
  id: string;                           // React key용 고유 ID
  toolNo: string;                       // 공구 번호 (예: "T0101"), separator일 때 ""
  isSeparator: boolean;                 // true = 시각적 구분선 행
  varNos: Record<string, number>;       // colKey → 변수 번호 (예: { preset: 12001, count: 12101 })
}

export interface ToolLifePathConfig {
  pathNo: 1 | 2;
  columns: ToolLifeColumn[];
  entries: ToolLifeEntry[];             // 공구 목록 + 구분선
}

export interface ToolLifeConfig {
  paths: ToolLifePathConfig[];
}

// ── Section 11: PMC Messages (PMC 비트 기반 메시지) ─────────
export interface PmcMessageEntry {
  id: string;
  pmcAddr: string;    // PMC 주소/비트 (예: "A209.5", "R6001.3")
  message: string;    // 표시할 메시지 내용
}

// ── Section 10: TopBar Interlock (페이지별 인터록 표시) ────
export interface TopBarInterlockField {
  id: string;            // 고유 식별자
  label: string;         // 명칭 (탑바 pill 표시명)
  pmcAddr: string;       // PMC 주소 (예: R6001.3)
  contact: 'A' | 'B';   // A접=신호1이면 정상(녹색), B접=신호0이면 정상(녹색)
  enabled: boolean;      // 이 항목 표시 여부
}

export interface TopBarInterlockPageConfig {
  interlockEnabled: boolean;       // 전체 인터록 활성화/비활성화
  fields: TopBarInterlockField[];  // 인터록 항목 목록
}

export interface TopBarInterlockConfig {
  remote:    TopBarInterlockPageConfig;  // 원격 조작반 페이지
  scheduler: TopBarInterlockPageConfig;  // 스케줄러 페이지
  transfer:  TopBarInterlockPageConfig;  // 파일 전송 페이지
  backup:    TopBarInterlockPageConfig;  // 백업 페이지
}

// ── Section 9: Capabilities ──────────────────────────────
export interface Capabilities {
  monitoring: boolean;
  scheduler: boolean;
  fileTransfer: boolean;
  alarmHistory: boolean;
  remoteControl: boolean;
  hasSubSpindle: boolean;
  hasCAxis: boolean;
  hasYAxis: boolean;
}

// ── Full Template ─────────────────────────────────────────
export interface CncTemplate {
  id: string;
  templateId: string;
  version: string;
  name: string;
  description: string;
  systemInfo: SystemInfo;
  axisConfig: AxisConfig;
  pmcMap: PmcMap;
  virtualPanel: VirtualPanel;
  schedulerConfig: SchedulerConfig;
  capabilities: Capabilities;
  panelLayout: PanelGroup[];                   // 조작반 커스텀 레이아웃
  topBarInterlock: TopBarInterlockConfig;      // 페이지별 인터록 표시 설정
  offsetConfig?: OffsetConfig;                 // 오프셋 표시 설정
  counterConfig?: CounterConfig;               // 카운터 필드 설정
  toolLifeConfig?: ToolLifeConfig;             // 공구 수명 설정
  pmcMessages?: PmcMessageEntry[];             // PMC 비트 기반 메시지 정의
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
}

// ── Store ─────────────────────────────────────────────────
const STORAGE_KEY = 'star-webcnc-templates';

interface TemplateState {
  templates: CncTemplate[];
  selectedTemplateId: string | null;

  loadTemplates: () => void;
  selectTemplate: (id: string | null) => void;
  createTemplate: () => string;
  duplicateTemplate: (id: string) => string;
  updateTemplate: (id: string, updates: Partial<CncTemplate>) => void;
  deleteTemplate: (id: string) => void;
  importFromJsonc: (text: string) => string;
  exportToJsonc: (id: string) => string;
}

function saveToStorage(templates: CncTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch { /* quota exceeded - ignore */ }
}

const EMPTY_PAGE_CONFIG: TopBarInterlockPageConfig = { interlockEnabled: true, fields: [] };

function migrateTopBarInterlock(raw: unknown): TopBarInterlockConfig {
  const def = {
    remote:    { ...EMPTY_PAGE_CONFIG },
    scheduler: { ...EMPTY_PAGE_CONFIG },
    transfer:  { ...EMPTY_PAGE_CONFIG },
    backup:    { ...EMPTY_PAGE_CONFIG },
  };
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Record<string, unknown>;
  const migratePageOrArray = (v: unknown): TopBarInterlockPageConfig => {
    if (!v) return { ...EMPTY_PAGE_CONFIG };
    // 이미 새 포맷: { interlockEnabled, fields }
    if (typeof v === 'object' && !Array.isArray(v) && 'fields' in (v as object)) {
      return v as TopBarInterlockPageConfig;
    }
    // 구형 포맷: 배열 그대로 → { interlockEnabled: true, fields: [] } (기존 키 기반 필드는 버림)
    return { interlockEnabled: true, fields: [] };
  };
  return {
    remote:    migratePageOrArray(r.remote),
    scheduler: migratePageOrArray(r.scheduler),
    transfer:  migratePageOrArray(r.transfer),
    backup:    migratePageOrArray(r.backup) ?? { ...EMPTY_PAGE_CONFIG },
  };
}

function loadFromStorage(): CncTemplate[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CncTemplate[];
    return parsed.map((t) => {
      let result = { ...t };

      // topBarInterlock 마이그레이션 (구형 배열 포맷 → 새 PageConfig 포맷)
      result = {
        ...result,
        topBarInterlock: migrateTopBarInterlock(result.topBarInterlock as unknown),
      };

      return result;
    });
  } catch {
    return null;
  }
}

// ── JSONC Utilities ───────────────────────────────────────

function stripJsoncComments(text: string): string {
  // Remove single-line comments (// ...) that are not inside strings
  // Simple approach: remove lines where // is not preceded by : "
  let result = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' && (i === 0 || text[i - 1] !== '\\')) {
      inString = !inString;
      result += ch;
      i++;
    } else if (!inString && ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
      // Skip rest of line
      while (i < text.length && text[i] !== '\n') i++;
    } else {
      result += ch;
      i++;
    }
  }
  // Remove trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, '$1');
  return result;
}

function stripAnnotationKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripAnnotationKeys);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key.startsWith('_')) continue;
      result[key] = stripAnnotationKeys(value);
    }
    return result;
  }
  return obj;
}

export function parseJsonc(text: string): Record<string, unknown> {
  const json = stripJsoncComments(text);
  const parsed = JSON.parse(json);
  return stripAnnotationKeys(parsed) as Record<string, unknown>;
}

// ── Default Template Factory ──────────────────────────────

function createDefaultTemplate(): CncTemplate {
  const now = new Date().toISOString();
  return {
    id: `tpl-${Date.now()}`,
    templateId: '',
    version: '1.0.0',
    name: '',
    description: '',
    systemInfo: {
      cncType: 'FANUC',
      seriesName: '',
      modelName: '',
      maxPaths: 2,
      maxAxes: 0,
      supportedOptions: [],
      coordinateDecimalPlaces: 3,
    },
    axisConfig: {
      path1: { axes: [], spindleName: '', toolPrefix: '' },
      path2: { axes: [], spindleName: '', toolPrefix: '' },
      path3: { axes: null, spindleName: null, toolPrefix: null },
    },
    pmcMap: {
      interlock: { doorClosed: null, chuckClamped: null, spindleStopped: null, coolantLevel: null },
      status: { operationMode: null, cycleRunning: null, alarmActive: null, emergencyStop: null, programEnd: null },
      control: { cycleStart: null, feedHold: null, singleBlock: null, reset: null },
      counters: { partCount: null, targetCount: null, cycleTime: null },
      scheduler: { loadable: null, dataReady: null, m20Complete: null },
    },
    virtualPanel: {
      modeKeys: { edit: null, memory: null, mdi: null, jog: null, ref: null, handle: null },
      controlKeys: { cycleStart: null, feedHold: null, reset: null, alarmClear: null },
      toggleKeys: { singleBlock: null, dryRun: null, optionalStop: null, blockSkip: null },
      overrides: { feedRate: null, spindleRate: null },
    },
    schedulerConfig: {
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
    },
    capabilities: {
      monitoring: true,
      scheduler: true,
      fileTransfer: true,
      alarmHistory: true,
      remoteControl: false,
      hasSubSpindle: false,
      hasCAxis: false,
      hasYAxis: false,
    },
    panelLayout: [],
    topBarInterlock: {
      remote:    { interlockEnabled: true, fields: [] },
      scheduler: { interlockEnabled: true, fields: [] },
      transfer:  { interlockEnabled: true, fields: [] },
      backup:    { interlockEnabled: true, fields: [] },
    },
    offsetConfig: { toolCount: 64, pageSize: 16 },
    counterConfig: { fields: [] },
    toolLifeConfig: { paths: [] },
    pmcMessages: [],
    createdAt: now,
    updatedAt: now,
    createdBy: '',
    isActive: true,
  };
}

// ── (MOCK_SB20R2 제거됨 — 실장비 연동, 템플릿은 DB/API에서 로드) ──

// Delete-me stub — remove when TS stops complaining
const _MOCK_SB20R2_STUB: Partial<CncTemplate> = {
  id: 'tpl-sb20r2-seed',
  templateId: 'FANUC_0i-TF Plus_SB-20R2_V1',
  version: '1.0.0',
  name: 'Star SB-20R2 (FANUC 0i-TF Plus)',
  description: 'Star SB-20R2 2계통 자동선반, FANUC 0i-TF Plus 컨트롤러',
  systemInfo: {
    cncType: 'FANUC',
    seriesName: '0i-TF Plus',
    modelName: 'SB-20R2',
    maxPaths: 2,
    maxAxes: 5,
    supportedOptions: [],
    coordinateDecimalPlaces: 4, // SB-20R2: IS-C 0.0001mm
  },
  axisConfig: {
    path1: { axes: ['X', 'Z', 'C', 'Y', 'A', 'CRG'], spindleName: 'S1', toolPrefix: 'T0100 ~ T3523' },
    path2: { axes: ['X', 'Z', 'C', 'A'], spindleName: 'S2', toolPrefix: 'T2000 ~ T2900' },
    path3: { axes: null, spindleName: null, toolPrefix: null },
  },
  pmcMap: {
    interlock: {
      doorClosed: { type: 'R', address: 6001, bit: 3, dataType: 'bit' },       // 메인 도어 닫힘 (1=닫힘, 0=열림)
      chuckClamped: { type: 'R', address: 6000, bit: 2, dataType: 'bit' },     // 메인 스핀들 클램프
      spindleStopped: null,                                                     // ※ 확인 필요
      coolantLevel: { type: 'R', address: 6001, bit: 6, dataType: 'bit' },     // 절삭유 레벨 (1=정상)
    },
    status: {
      operationMode: null,                                                      // ※ 개별 비트 → FOCAS statinfo 대체
      cycleRunning: { type: 'R', address: 6003, bit: 0, dataType: 'bit' },     // 메인 기동중 STL (1=실행중)
      alarmActive: null,                                                        // ※ 확인 필요
      emergencyStop: { type: 'R', address: 6001, bit: 2, dataType: 'bit' },    // 비상정지 (1=비상정지)
      programEnd: { type: 'R', address: 6002, bit: 4, dataType: 'bit' },       // M20 메인 완료
    },
    control: {
      cycleStart: { type: 'R', address: 6105, bit: 4, dataType: 'bit' },       // CYCLE START 출력
      feedHold: { type: 'R', address: 6105, bit: 3, dataType: 'bit' },         // FEED HOLD 출력
      singleBlock: { type: 'R', address: 6106, bit: 1, dataType: 'bit' },      // SINGLE BLOCK 출력
      reset: { type: 'R', address: 6103, bit: 0, dataType: 'bit' },            // RESET 출력
    },
    counters: { partCount: null, targetCount: null, cycleTime: null },
    scheduler: {
      loadable: null,
      dataReady: null,
      m20Complete: { type: 'R', address: 6002, bit: 4, dataType: 'bit' },      // M20 메인 완료 → 카운트 트리거
    },
  },
  virtualPanel: {
    modeKeys: {
      edit: { keyId: 'edit', displayName: 'EDIT', keyType: 'selector',
        pmcOutput: { type: 'R', address: 6104, bit: 4, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6004, bit: 4, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'normal' },
      memory: { keyId: 'memory', displayName: 'MEMORY', keyType: 'selector',
        pmcOutput: { type: 'R', address: 6104, bit: 5, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6004, bit: 5, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'normal' },
      mdi: { keyId: 'mdi', displayName: 'MDI', keyType: 'selector',
        pmcOutput: { type: 'R', address: 6104, bit: 6, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6004, bit: 6, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'normal' },
      jog: { keyId: 'jog', displayName: 'JOG', keyType: 'selector',
        pmcOutput: { type: 'R', address: 6105, bit: 0, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6005, bit: 0, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'normal' },
      ref: { keyId: 'ref', displayName: 'ZERO RETURN', keyType: 'selector',
        pmcOutput: { type: 'R', address: 6105, bit: 2, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6005, bit: 2, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'normal' },
      handle: { keyId: 'handle', displayName: 'HANDLE', keyType: 'selector',
        pmcOutput: { type: 'R', address: 6104, bit: 7, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6004, bit: 7, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'normal' },
    },
    controlKeys: {
      cycleStart: { keyId: 'cycleStart', displayName: 'CYCLE START', keyType: 'momentary',
        pmcOutput: { type: 'R', address: 6105, bit: 4, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6005, bit: 4, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'critical' },
      feedHold: { keyId: 'feedHold', displayName: 'FEED HOLD', keyType: 'momentary',
        pmcOutput: { type: 'R', address: 6105, bit: 3, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6005, bit: 3, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'caution' },
      reset: { keyId: 'reset', displayName: 'RESET', keyType: 'momentary',
        pmcOutput: { type: 'R', address: 6103, bit: 0, dataType: 'bit' },
        pmcFeedback: null,
        requiresInterlock: true, safetyLevel: 'caution' },
      alarmClear: null,                                                         // ※ 확인 필요
    },
    toggleKeys: {
      singleBlock: { keyId: 'singleBlock', displayName: 'SINGLE BLOCK', keyType: 'toggle',
        pmcOutput: { type: 'R', address: 6106, bit: 1, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6006, bit: 1, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'caution' },
      dryRun: null,                                                             // ※ AIR CUT(R6105.6)이 dryRun인지 확인 필요
      optionalStop: { keyId: 'optionalStop', displayName: 'OPTIONAL STOP', keyType: 'toggle',
        pmcOutput: { type: 'R', address: 6105, bit: 7, dataType: 'bit' },
        pmcFeedback: { type: 'R', address: 6005, bit: 7, dataType: 'bit' },
        requiresInterlock: true, safetyLevel: 'normal' },
      blockSkip: null,                                                          // ※ 테이블에 없음
    },
    overrides: { feedRate: null, spindleRate: null },
  },
  schedulerConfig: {
    cycleStartAddr: 'R6105.4',     // 사이클 스타트 출력 (실기기 확인값)
    m20Addr: 'R6002.4',            // M20 완료 신호 (실기기 확인값)
    countDisplay: { countMacroNo: 900, countVarType: 'macro' as const, presetMacroNo: 10000, presetVarType: 'pcode' as const, cycleTimeAddr: 'D96', cycleTimeMultiplier: 4 },
    resetAddr: 'R6103.0',          // RESET 신호 (실기기 확인값)
    oneCycleStopAddr: '',          // 원사이클 스톱 출력 (미확인)
    oneCycleStopStatusAddr: '',    // 원사이클 스톱 상태 (미확인)
    mainHeadAddr: '',              // MAIN HEAD 출력 (미확인)
    mainHeadStatusAddr: '',        // MAIN HEAD 상태 (미확인)
    subHeadAddr: '',               // SUB HEAD 출력 (미확인)
    subHeadStatusAddr: '',         // SUB HEAD 상태 (미확인)
    path2OnlyConfirmAddr: '',
    path2OnlyConfirmDelayMs: 500,
    path2OnlyTimeoutMs: 4000,
    path2OnlyTimeoutAction: 'error',
    maxQueueSize: 15,
  },
  capabilities: {
    monitoring: true, scheduler: true, fileTransfer: true, alarmHistory: true,
    remoteControl: true, hasSubSpindle: true, hasCAxis: true, hasYAxis: true,
  },
  panelLayout: [
    { id: 'grp-head', name: 'HEAD', keys: [
      { id: 'HEAD1', label: 'HEAD 1', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0010.0', lampAddr: 'R0010.0', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'HEAD2', label: 'HEAD 2', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0010.1', lampAddr: 'R0010.1', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'HEAD_CHANGE', label: 'HEAD CHANGE', hasLamp: false, color: 'gray', size: 'normal', reqAddr: 'Y0010.3', lampAddr: '', timing: { longPressMs: 1500, holdMs: 300, timeoutMs: 2000 } },
    ]},
    { id: 'grp-chuck', name: 'CHUCKING', sameRowAsPrev: true, keys: [
      { id: 'MAIN_CHUCK', label: 'MAIN CHUCKING', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0011.0', lampAddr: 'R0011.0', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'SUB_CHUCK', label: 'SUB CHUCKING', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0011.1', lampAddr: 'R0011.1', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
    ]},
    { id: 'grp-mode', name: 'MODE', keys: [
      { id: 'EDIT', label: 'EDIT', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0020.0', lampAddr: 'R0020.0', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'MEMORY', label: 'MEMORY', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0020.1', lampAddr: 'R0020.1', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'MDI', label: 'MDI', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0020.2', lampAddr: 'R0020.2', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'JOG', label: 'JOG', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0020.3', lampAddr: 'R0020.3', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'DNC', label: 'DNC', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0020.4', lampAddr: 'R0020.4', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
    ]},
    { id: 'grp-op', name: 'OPERATION', keys: [
      { id: 'SINGLE_BLOCK', label: 'SINGLE BLOCK', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0021.0', lampAddr: 'R0021.0', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'OPT_STOP', label: 'OPTIONAL STOP', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0021.1', lampAddr: 'R0021.1', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'ONE_CYCLE', label: 'ONE CYCLE', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0021.2', lampAddr: 'R0021.2', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'AIR_CUT', label: 'AIR CUT', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0021.3', lampAddr: 'R0021.3', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'AUTO_PWR_OFF', label: 'AUTO POWER OFF', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0021.4', lampAddr: 'R0021.4', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'WORK_LIGHT', label: 'WORK LIGHT', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'Y0021.5', lampAddr: 'R0021.5', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
    ]},
    { id: 'grp-cycle', name: 'CYCLE', keys: [
      { id: 'CYCLE_START', label: 'CYCLE START', hasLamp: true, color: 'green', size: 'large', reqAddr: 'Y0030.0', lampAddr: 'R0030.0', timing: { longPressMs: 2000, holdMs: 500, timeoutMs: 3000 } },
      { id: 'FEED_HOLD', label: 'FEED HOLD', hasLamp: true, color: 'yellow', size: 'large', reqAddr: 'Y0030.1', lampAddr: 'R0030.1', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
      { id: 'E_STOP', label: 'EMERGENCY STOP', hasLamp: false, color: 'red', size: 'large', reqAddr: 'Y0030.2', lampAddr: '', timing: { longPressMs: 3000, holdMs: 1000, timeoutMs: 5000 } },
      { id: 'RESET', label: 'RESET', hasLamp: false, color: 'gray', size: 'large', reqAddr: 'Y0030.3', lampAddr: '', timing: { longPressMs: 1500, holdMs: 500, timeoutMs: 3000 } },
    ]},
  ],
  topBarInterlock: {
    remote: { interlockEnabled: true, fields: [
      { id: 'rc-door',  label: '도어 닫힘',   pmcAddr: 'R6001.3', contact: 'A', enabled: true },   // A접: 1=닫힘=OK
      { id: 'rc-estop', label: '비상정지 해제', pmcAddr: 'R6001.2', contact: 'B', enabled: true },  // B접: 0=비상정지없음=OK
    ]},
    scheduler: { interlockEnabled: true, fields: [
      { id: 'sc-door',  label: '도어 닫힘',   pmcAddr: 'R6001.3', contact: 'A', enabled: true },
      { id: 'sc-estop', label: '비상정지 해제', pmcAddr: 'R6001.2', contact: 'B', enabled: true },
    ]},
    transfer:  { interlockEnabled: false, fields: [] },
    backup:    { interlockEnabled: false, fields: [] },
  },
  offsetConfig: { toolCount: 64, pageSize: 16 },

  counterConfig: {
    fields: [
      { key: 'preset',    label: 'PRESET',    varType: 'macro', varNo: 500, readonly: false },
      { key: 'count',     label: 'COUNT',     varType: 'macro', varNo: 501, readonly: false },
      { key: 'total',     label: 'TOTAL',     varType: 'macro', varNo: 502, readonly: true  },
      { key: 'remaining', label: 'REMAINING', varType: 'macro', varNo: 503, readonly: true  },
    ],
  },

  toolLifeConfig: {
    paths: [
      {
        pathNo: 1,
        columns: [
          { key: 'preset', label: 'PRESET', varType: 'macro', readonly: false, unit: '회' },
          { key: 'count',  label: 'COUNT',  varType: 'macro', readonly: true,  unit: '회' },
        ],
        entries: [
          { id: 'p1-t1', toolNo: 'T0101', isSeparator: false, varNos: { preset: 3001, count: 3002 } },
          { id: 'p1-t2', toolNo: 'T0202', isSeparator: false, varNos: { preset: 3003, count: 3004 } },
          { id: 'p1-t3', toolNo: 'T0303', isSeparator: false, varNos: { preset: 3005, count: 3006 } },
          { id: 'p1-t4', toolNo: 'T0404', isSeparator: false, varNos: { preset: 3007, count: 3008 } },
          { id: 'p1-t5', toolNo: 'T0505', isSeparator: false, varNos: { preset: 3009, count: 3010 } },
          { id: 'p1-t6', toolNo: 'T0606', isSeparator: false, varNos: { preset: 3011, count: 3012 } },
          { id: 'p1-t7', toolNo: 'T0707', isSeparator: false, varNos: { preset: 3013, count: 3014 } },
          { id: 'p1-t8', toolNo: 'T0808', isSeparator: false, varNos: { preset: 3015, count: 3016 } },
          { id: 'p1-t9', toolNo: 'T0909', isSeparator: false, varNos: { preset: 3017, count: 3018 } },
        ],
      },
      {
        pathNo: 2,
        columns: [
          { key: 'preset', label: 'PRESET', varType: 'macro', readonly: false, unit: '회' },
          { key: 'count',  label: 'COUNT',  varType: 'macro', readonly: true,  unit: '회' },
        ],
        entries: [
          { id: 'p2-t1', toolNo: 'T3101', isSeparator: false, varNos: { preset: 3101, count: 3102 } },
          { id: 'p2-t2', toolNo: 'T3202', isSeparator: false, varNos: { preset: 3103, count: 3104 } },
        ],
      },
    ],
  },

  createdAt: '2026-02-09T00:00:00Z',
  updatedAt: '2026-02-09T00:00:00Z',
  createdBy: 'HQ_ENGINEER',
  isActive: true,
};
void _MOCK_SB20R2_STUB;

// ── Zustand Store ─────────────────────────────────────────

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  selectedTemplateId: null,

  loadTemplates: () => {
    const stored = loadFromStorage();
    if (stored && stored.length > 0) {
      // 로컬 데이터 우선 (사용자 편집 내용 보존)
      set({ templates: stored, selectedTemplateId: stored[0].id });
    }

    // 항상 서버에서 최신 템플릿 로드 (로컬 캐시 덮어쓰기)
    templateApi.getAll()
      .then((res) => {
        const serverTemplates = (res.data as CncTemplate[] | null);
        if (serverTemplates && serverTemplates.length > 0) {
          const migrated = serverTemplates.map((t) => ({
            ...t,
            topBarInterlock: migrateTopBarInterlock(t.topBarInterlock as unknown),
          }));
          saveToStorage(migrated);
          set((s) => ({
            templates: migrated,
            selectedTemplateId: migrated.find((t) => t.id === s.selectedTemplateId)
              ? s.selectedTemplateId
              : migrated[0].id,
          }));
        }
      })
      .catch(() => {
        // 서버 미연결 시 로컬 캐시 유지. 로컬도 없으면 빈 배열 유지
      });
  },

  selectTemplate: (id) => {
    set({ selectedTemplateId: id });
  },

  createTemplate: () => {
    const tpl = createDefaultTemplate();
    const updated = [...get().templates, tpl];
    saveToStorage(updated);
    set({ templates: updated, selectedTemplateId: tpl.id });
    return tpl.id;
  },

  duplicateTemplate: (id) => {
    const src = get().templates.find(t => t.id === id);
    if (!src) return '';
    const now = new Date().toISOString();
    const dup: CncTemplate = {
      ...structuredClone(src),
      id: `tpl-${Date.now()}`,
      templateId: src.templateId + '-copy',
      name: src.name + ' (복제)',
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...get().templates, dup];
    saveToStorage(updated);
    set({ templates: updated, selectedTemplateId: dup.id });
    return dup.id;
  },

  updateTemplate: (id, updates) => {
    const updated = get().templates.map(t =>
      t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
    );
    saveToStorage(updated);
    set({ templates: updated });

    // 서버 DB에 즉시 반영 후 Agent에 reload 알림
    const tpl = updated.find(t => t.id === id);
    if (tpl) {
      templateApi.update(id, tpl as unknown as Record<string, unknown>)
        .then(() => templateApi.reload(id))
        .catch((err) => console.error('[TemplateStore] Server update failed:', err));
    }
  },

  deleteTemplate: (id) => {
    const updated = get().templates.filter(t => t.id !== id);
    saveToStorage(updated);
    const sel = get().selectedTemplateId === id
      ? (updated[0]?.id ?? null)
      : get().selectedTemplateId;
    set({ templates: updated, selectedTemplateId: sel });
  },

  importFromJsonc: (text) => {
    const parsed = parseJsonc(text);
    const now = new Date().toISOString();
    const base = createDefaultTemplate();
    // Merge parsed values over defaults
    const tpl: CncTemplate = {
      ...base,
      ...parsed as Partial<CncTemplate>,
      id: `tpl-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };
    // Deep merge nested objects that might be partially filled
    if (parsed.systemInfo) tpl.systemInfo = { ...base.systemInfo, ...(parsed.systemInfo as Partial<SystemInfo>) };
    if (parsed.axisConfig) tpl.axisConfig = { ...base.axisConfig, ...(parsed.axisConfig as Partial<AxisConfig>) };
    if (parsed.pmcMap) {
      const pm = parsed.pmcMap as Partial<PmcMap>;
      tpl.pmcMap = {
        interlock: { ...base.pmcMap.interlock, ...pm.interlock },
        status: { ...base.pmcMap.status, ...pm.status },
        control: { ...base.pmcMap.control, ...pm.control },
        counters: { ...base.pmcMap.counters, ...pm.counters },
        scheduler: { ...base.pmcMap.scheduler, ...pm.scheduler },
      };
    }
    if (parsed.virtualPanel) {
      const vp = parsed.virtualPanel as Partial<VirtualPanel>;
      tpl.virtualPanel = {
        modeKeys: { ...base.virtualPanel.modeKeys, ...vp.modeKeys },
        controlKeys: { ...base.virtualPanel.controlKeys, ...vp.controlKeys },
        toggleKeys: { ...base.virtualPanel.toggleKeys, ...vp.toggleKeys },
        overrides: { ...base.virtualPanel.overrides, ...vp.overrides },
      };
    }
    if (parsed.schedulerConfig) tpl.schedulerConfig = { ...base.schedulerConfig, ...(parsed.schedulerConfig as Partial<SchedulerConfig>) };
    if (parsed.capabilities) tpl.capabilities = { ...base.capabilities, ...(parsed.capabilities as Partial<Capabilities>) };

    const updated = [...get().templates, tpl];
    saveToStorage(updated);
    set({ templates: updated, selectedTemplateId: tpl.id });
    return tpl.id;
  },

  exportToJsonc: (id) => {
    const tpl = get().templates.find(t => t.id === id);
    if (!tpl) return '';
    // Export without internal id field
    const { id: _id, ...exportData } = tpl;
    return JSON.stringify(exportData, null, 2);
  },
}));

// ── Selector Hooks ────────────────────────────────────────
export const useSelectedTemplate = () =>
  useTemplateStore(s => s.templates.find(t => t.id === s.selectedTemplateId) ?? null);

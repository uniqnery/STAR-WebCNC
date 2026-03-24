// Machine Store - Zustand

import { create } from 'zustand';
import { wsClient } from '../lib/wsClient';
import { machineApi } from '../lib/api';
import { useAuthStore } from './authStore';
import { useFileStore } from './fileStore';

// Path 좌표 데이터 (CNC 자동선반 Path1/Path2)
export interface PathCoordinates {
  absolute: number[];       // ABSOLUTE [X, Y, Z, C] — raw CNC integer value
  distanceToGo: number[];   // DISTANCE TO GO [X, Y, Z, C] — raw CNC integer value
  decimalPlaces?: number[]; // 축별 소수점 자릿수 (ODBAXIS.type): IS-B=3, IS-C=4
}

// 모달 G코드 정보 (활성 G코드 그리드 + F/M/T/S 값)
export interface ModalGCodeInfo {
  gCodeGrid: string[][];  // 5행 × 4열 G코드 모달 그리드 (group 1-20)
  feedActual: number;    // 실제 이송 (mm/min)
  repeatCurrent: number; // 반복 현재
  repeatTotal: number;   // 반복 전체
  spindleActual: number; // 실제 스핀들 RPM
}

// Path 데이터 (프로그램 + 좌표 + 모달정보)
export interface PathData {
  programNo: string;           // 프로그램 번호
  blockNo: string;             // 블록 번호 (N00020 등)
  programContent: string[];    // 실행 중인 프로그램 라인들 (약 6줄)
  currentLine: number;         // 현재 실행 중인 라인 인덱스 (> 표시)
  axisNames?: string[];        // CNC에서 읽은 실제 축 이름 (X, Z, C2 등)
  coordinates: PathCoordinates;
  modal: ModalGCodeInfo;       // 모달 G코드 + F/M/T/S
  pathStatus: string;          // 상태 표시 (예: 'MEM STRT ---- ---')
}

// 인터록 상태
export interface InterlockStatus {
  doorLock: boolean;           // 도어록
  memoryMode: boolean;         // 메모리모드
  barFeederAuto: boolean;      // 바피더오토
  coolantOn: boolean;          // 절삭유ON
  machiningMode: boolean;      // 머시닝모드
  cuttingMode: boolean;        // 절단모드
  extra1?: boolean;            // 기타1 (확장용)
  extra2?: boolean;            // 기타2 (확장용)
}

// FOCAS 이벤트 타입
export type FocasEventType =
  | 'PROGRAM_SELECT'         // 프로그램 선택
  | 'CYCLE_START'            // 사이클 스타트
  | 'CYCLE_START_ACK'        // 사이클 스타트 실행 확인
  | 'FEED_HOLD'              // 피드 홀드
  | 'RESET'                  // 리셋
  | 'ALARM_CLEAR'            // 알람 해제
  | 'MODE_CHANGE'            // 모드 변경
  | 'M20_COMPLETE'           // M20 카운트 완료
  | 'OVERRIDE_CHANGE'        // 오버라이드 변경
  | 'CONTROL_LOCK'           // 제어권 획득
  | 'CONTROL_UNLOCK'         // 제어권 해제
  | 'INTERLOCK_CHANGE'       // 인터록 상태 변경
  | 'COMMAND_SENT'           // 명령 전송
  | 'COMMAND_ACK'            // 명령 응답
  | 'COMMAND_RESULT'         // 명령 결과
  | 'SCHEDULER_STARTED'      // 스케줄러 시작
  | 'SCHEDULER_STOPPED'      // 스케줄러 정지
  | 'SCHEDULER_COMPLETED'    // 스케줄러 전체 완료
  | 'SCHEDULER_ROW_COMPLETED'// 행 완료
  | 'SCHEDULER_PAUSED'       // 스케줄러 일시정지
  | 'SCHEDULER_ERROR'        // 스케줄러 오류
  | 'INTERLOCK_FAIL'         // 인터락 불만족
  | 'ONE_CYCLE_STOP_ON'      // 원사이클 스톱 ON
  | 'ONE_CYCLE_STOP_OFF'     // 원사이클 스톱 OFF
  | 'HEAD_ON';               // 헤드 ON

// FOCAS 이벤트 로그
export interface FocasEvent {
  id: string;
  machineId: string;
  type: FocasEventType;
  message: string;
  level?: 'error' | 'warn' | 'info';
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface TelemetryData {
  runState: number;
  mode: string;
  programNo: string;
  subProgramNo?: string;       // 서브 프로그램 번호
  productName?: string;        // 제품명 (NC 코멘트에서 추출)
  feedrate: number;
  spindleSpeed: number;
  spindleLoad?: number;        // 스핀들 부하 (%)
  partsCount: number;
  presetCount?: number;        // 목표 수량 (PRESET)
  cycleTime?: number;          // 사이클타임 (초)
  dailyRunRate?: number;       // 일일 가동률 (%)
  alarmActive: boolean;
  absolutePosition?: number[];
  machinePosition?: number[];

  // Path1/Path2 데이터 (CNC 자동선반용)
  path1?: PathData;
  path2?: PathData;

  // 인터록 상태
  interlock?: InterlockStatus;

  // PMC 비트 실시간 값 (address string → 0|1, 예: { 'R6001.3': 1, 'R6001.2': 0 })
  pmcBits?: Record<string, 0 | 1>;

  // 오퍼레이터 메시지 (NC프로그램 #3006, 외부 신호 등) — telemetry 1s 주기
  operatorMessages?: OperatorMessage[];

  // NC 데이터 탭
  offsetData?: OffsetData;
  countData?: CountData;
  toolLifeData?: ToolLifeData;
}

export interface OperatorMessage {
  number: number;
  msgType: number;   // 0=EX(외부), 1=매크로(#3006) 등
  message: string;
}

// ─── OFFSET 데이터 ───
export type OffsetViewMode = 'wear' | 'geometry';

export interface OffsetEntry {
  no: number;       // 보정 번호 (1~64)
  x: number;        // X 보정값 (mm) - R/W
  y: number;        // Y 보정값 (mm) - R/W
  z: number;        // Z 보정값 (mm) - R/W
  r: number;        // R 노즈 반경 (mm) - R/W
  t: number;        // T 타입 코드 - READ-ONLY
}

export interface OffsetData {
  path1Wear: OffsetEntry[];
  path2Wear: OffsetEntry[];
  path1Geometry: OffsetEntry[];
  path2Geometry: OffsetEntry[];
}

// ─── COUNT 데이터 ───
export interface CounterData {
  counterOn: boolean;    // R/W
  preset: number;        // R/W
  count: number;         // R (리셋만 가능)
  total: number;         // R
}

export interface TimeData {
  runningTime: string;     // R
  cycleTime: string;       // R
  remainingTime: string;   // R (계산값)
  completionTime: string;  // R (계산값)
}

export interface BarFeederData {
  barLength: number;       // R (mm)
  remnant: number;         // R (mm)
  partLength: number;      // R (mm)
  cutOffWidth: number;     // R (mm)
  requiredBars: number;    // R
  numberOfParts: number;   // R
  barChangeTime: string;   // R
}

export interface CountData {
  counter: CounterData;
  time: TimeData;
  barFeeder: BarFeederData;
}

// ─── TOOL-LIFE 데이터 ───
export interface ToolLifeEntry {
  toolNo: string;     // T0100 등 - R
  preset: number;     // R/W
  count: number;      // R
}

export interface ToolLifeData {
  counterOn: boolean;           // R/W
  nonStopTimePeriod: boolean;   // R/W
  countUpNotice: boolean;       // R/W
  path1Tools: ToolLifeEntry[];
  path2Tools: ToolLifeEntry[];
}

// DNC 경로 설정 (Path 단위)
export interface DncPathConfig {
  path1: string;   // Path 1 DNC 폴더 경로
  path2: string;   // Path 2 DNC 폴더 경로
  path3?: string;  // Path 3 DNC 폴더 경로 (장비가 지원할 때만)
}

// 장비별 DNC 설정
export interface MachineDncConfig {
  machineId: string;
  pathCount: number;               // 2 또는 3
  mainMode: 'memory' | 'dnc';     // Path1(메인) 실행 모드
  subMode:  'memory' | 'dnc';     // Path2(서브) 실행 모드
  dncPaths: DncPathConfig;
  // 행 추가 기본값 (localStorage only — 서버 미전송)
  defaultMainPgm?: string;         // 기본 메인 프로그램 번호 (예: "O0001")
  defaultSubPgm?: string;          // 기본 서브 프로그램 번호 (미설정 시 비어있음)
  defaultPreset?: number;          // 기본 프리셋 수량
  updatedAt?: string;
  updatedBy?: string;
}

// Scheduler 행 (SchedulerRow — Agent count authority)
export interface SchedulerRow {
  id: string;
  machineId: string;
  order: number;
  mainProgramNo: string;
  subProgramNo?: string;
  preset: number;
  count: number;          // Agent authority — Server가 보고값으로 갱신
  status: 'PENDING' | 'RUNNING' | 'COMPLETED';
  lastError?: string;
  lastErrorCode?: string;
  lastErrorAt?: string;
  createdBy?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type SchedulerState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'ERROR';

export interface SchedulerErrorPayload {
  rowId?: string;
  code: string;
  message: string;
}

export interface Machine {
  id: string;
  machineId: string;
  name: string;
  ipAddress: string;
  port: number;
  isActive: boolean;
  pathCount?: number;  // 지원 Path 수 (기본 2, 최대 3)
  serialNumber?: string;  // CNC 시리얼번호
  location?: string;      // 설비 위치/라인명
  template?: {
    templateId: string;
    name: string;
    cncType: string;
    seriesName: string;
  };
  realtime?: {
    status: 'online' | 'offline';
    telemetry?: TelemetryData;
    controlLock?: {
      ownerId: string;
      ownerUsername: string;
      acquiredAt: string;
    } | null;
  };
}

export interface Alarm {
  id: string;
  alarmNo: number;
  alarmMsg: string;
  category?: string;
  occurredAt: string;
  clearedAt?: string;
}

// 제어권 상태
export interface ControlLockEntry {
  isOwner: boolean;
  ownerUsername: string | null;
  expiresAt: number | null; // timestamp ms
}

interface MachineState {
  machines: Machine[];
  selectedMachineId: string | null;
  telemetryMap: Record<string, TelemetryData>;
  activeAlarms: Record<string, Alarm[]>;
  focasEvents: Record<string, FocasEvent[]>;  // FOCAS 이벤트 로그
  schedulerRows: Record<string, SchedulerRow[]>;      // 스케줄러 큐 (장비별)
  schedulerState: Record<string, SchedulerState>;     // 장비별 Scheduler 상태 머신
  schedulerError: Record<string, SchedulerErrorPayload | null>;  // 최근 에러
  dncConfigs: Record<string, MachineDncConfig>;   // 장비별 DNC 경로 설정
  controlLockMap: Record<string, ControlLockEntry>;  // 장비별 제어권 상태
  controlLockDurationMin: number;  // 제어권 타이머 (분)
  isLoading: boolean;
  error: string | null;

  // Actions
  setMachines: (machines: Machine[]) => void;
  addMachine: (machine: Machine) => void;
  deleteMachine: (machineId: string) => void;
  selectMachine: (machineId: string | null) => void;
  updateTelemetry: (machineId: string, data: TelemetryData) => void;
  updatePmcBits: (machineId: string, pmcBits: Record<string, 0 | 1>) => void;
  addAlarm: (machineId: string, alarm: Alarm) => void;
  clearAlarm: (machineId: string, alarmNo: number) => void;
  addFocasEvent: (machineId: string, event: FocasEvent) => void;
  clearFocasEvents: (machineId: string) => void;
  setSchedulerRows: (machineId: string, rows: SchedulerRow[]) => void;
  setSchedulerState: (machineId: string, state: SchedulerState) => void;
  updateSchedulerCount: (machineId: string, rowId: string, count: number) => void;
  setSchedulerError: (machineId: string, err: SchedulerErrorPayload | null) => void;
  clearSchedulerError: (machineId: string) => void;
  setDncConfig: (machineId: string, config: MachineDncConfig) => void;
  acquireControlLock: (machineId: string, username: string) => void;
  releaseControlLock: (machineId: string) => void;
  extendControlLock: (machineId: string) => void;
  setControlLockDuration: (minutes: number) => void;
  updateOffsetEntry: (machineId: string, path: 'path1' | 'path2', mode: OffsetViewMode, no: number, field: 'x' | 'y' | 'z' | 'r', value: number) => void;
  updateCountData: (machineId: string, updates: Partial<{ counterOn: boolean; preset: number; resetCount: boolean }>) => void;
  updateToolLifeData: (machineId: string, updates: Partial<{ counterOn: boolean; nonStopTimePeriod: boolean; countUpNotice: boolean }>) => void;
  updateToolLifePreset: (machineId: string, path: 'path1' | 'path2', toolNo: string, preset: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // REST API
  fetchMachines: () => Promise<void>;

  // WebSocket
  wsConnected: boolean;
  initWebSocket: (token: string) => void;
  destroyWebSocket: () => void;
}


// localStorage 헬퍼
const SCHEDULER_ROWS_STORAGE_KEY = 'star-webcnc-scheduler-rows';
const DNC_CONFIG_STORAGE_KEY = 'star-webcnc-dnc-config';

function loadSchedulerRows(): Record<string, SchedulerRow[]> {
  try {
    const raw = localStorage.getItem(SCHEDULER_ROWS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSchedulerRows(rows: Record<string, SchedulerRow[]>) {
  try {
    localStorage.setItem(SCHEDULER_ROWS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // localStorage full or unavailable
  }
}

function loadDncConfigs(): Record<string, MachineDncConfig> {
  try {
    const raw = localStorage.getItem(DNC_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, MachineDncConfig>;
    // 기본값 보장 + 구버전 캐시 하위호환 (executionMode → mainMode/subMode)
    for (const key of Object.keys(parsed)) {
      const c = parsed[key] as MachineDncConfig & { executionMode?: string };
      if (!c.mainMode) c.mainMode = (c.executionMode as 'memory' | 'dnc') ?? 'memory';
      if (!c.subMode)  c.subMode  = 'memory';
      delete c.executionMode;
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveDncConfigs(configs: Record<string, MachineDncConfig>) {
  try {
    localStorage.setItem(DNC_CONFIG_STORAGE_KEY, JSON.stringify(configs));
  } catch {
    // localStorage full or unavailable
  }
}

// Machines (localStorage)
const MACHINES_STORAGE_KEY = 'star-webcnc-machines';

function loadMachines(): Machine[] | null {
  try {
    const raw = localStorage.getItem(MACHINES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Machine[]) : null;
  } catch {
    return null;
  }
}

function saveMachines(machines: Machine[]) {
  try {
    localStorage.setItem(MACHINES_STORAGE_KEY, JSON.stringify(machines));
  } catch {
    // localStorage full or unavailable
  }
}

// Control lock duration (localStorage)
const CONTROL_LOCK_DURATION_KEY = 'star-webcnc-control-lock-duration';

function loadControlLockDuration(): number {
  try {
    const raw = localStorage.getItem(CONTROL_LOCK_DURATION_KEY);
    return raw ? parseInt(raw) : 5;
  } catch {
    return 5;
  }
}

function saveControlLockDuration(minutes: number) {
  try {
    localStorage.setItem(CONTROL_LOCK_DURATION_KEY, String(minutes));
  } catch {
    // localStorage full or unavailable
  }
}

// WS 핸들러 cleanup 함수 (initWebSocket 재호출 시 기존 핸들러 제거 후 재등록)
let _wsCleanups: Array<() => void> = [];

export const useMachineStore = create<MachineState>((set, get) => ({
  machines: loadMachines() ?? [],
  selectedMachineId: null,
  telemetryMap: {},
  activeAlarms: {},
  focasEvents: {},
  schedulerRows: loadSchedulerRows(),
  schedulerState: {},
  schedulerError: {},
  dncConfigs: loadDncConfigs(),
  controlLockMap: {},
  controlLockDurationMin: loadControlLockDuration(),
  isLoading: false,
  error: null,
  wsConnected: false,

  setMachines: (machines) => {
    saveMachines(machines);
    return set({ machines });
  },

  addMachine: (machine) =>
    set((state) => {
      const updated = [...state.machines, machine];
      saveMachines(updated);
      return { machines: updated };
    }),

  deleteMachine: (machineId) =>
    set((state) => {
      const updated = state.machines.filter((m) => m.machineId !== machineId);
      saveMachines(updated);
      return {
        machines: updated,
        selectedMachineId:
          state.selectedMachineId === machineId ? null : state.selectedMachineId,
      };
    }),

  selectMachine: (machineId) =>
    set({ selectedMachineId: machineId }),

  updateTelemetry: (machineId, data) =>
    set((state) => {
      // 에이전트가 path1/path2/offsetData 등 rich 필드 없이 기본 telemetry만 보낼 수 있으므로
      // 기존 데이터와 merge — 새 값이 있으면 덮어쓰고, field 자체가 없으면(undefined) 기존 값 유지
      // 주의: null은 "없음"이 아니라 "에이전트가 명시적으로 비움"이므로 그대로 설정
      const existing = state.telemetryMap[machineId];
      const merged: TelemetryData = existing
        ? {
            ...existing,
            ...data,
            path1: 'path1' in data ? data.path1 : existing.path1,
            path2: 'path2' in data ? data.path2 : existing.path2,
            offsetData: 'offsetData' in data ? data.offsetData : existing.offsetData,
            countData: 'countData' in data ? data.countData : existing.countData,
            toolLifeData: 'toolLifeData' in data ? data.toolLifeData : existing.toolLifeData,
          }
        : data;
      return {
        telemetryMap: {
          ...state.telemetryMap,
          [machineId]: merged,
        },
        machines: state.machines.map((m) =>
          m.machineId === machineId
            ? { ...m, realtime: { ...m.realtime, status: 'online' as const, telemetry: merged } }
            : m
        ),
      };
    }),

  updatePmcBits: (machineId, pmcBits) =>
    set((state) => {
      const existing = state.telemetryMap[machineId];
      if (!existing) return state; // 텔레메트리가 아직 없으면 무시 (첫 telemetry 이후 적용)
      const merged = { ...existing, pmcBits };
      return {
        telemetryMap: { ...state.telemetryMap, [machineId]: merged },
      };
    }),

  addAlarm: (machineId, alarm) =>
    set((state) => {
      const current = state.activeAlarms[machineId] || [];
      return {
        activeAlarms: {
          ...state.activeAlarms,
          [machineId]: [...current, alarm],
        },
      };
    }),

  clearAlarm: (machineId, alarmNo) =>
    set((state) => {
      const current = state.activeAlarms[machineId] || [];
      return {
        activeAlarms: {
          ...state.activeAlarms,
          [machineId]: current.filter((a) => a.alarmNo !== alarmNo),
        },
      };
    }),

  addFocasEvent: (machineId, event) =>
    set((state) => {
      const current = state.focasEvents[machineId] || [];
      // 최신 50개만 유지
      const updated = [event, ...current].slice(0, 50);
      return {
        focasEvents: {
          ...state.focasEvents,
          [machineId]: updated,
        },
      };
    }),

  clearFocasEvents: (machineId) =>
    set((state) => ({
      focasEvents: {
        ...state.focasEvents,
        [machineId]: [],
      },
    })),

  setSchedulerRows: (machineId, rows) =>
    set((state) => {
      const updated = { ...state.schedulerRows, [machineId]: rows };
      saveSchedulerRows(updated);
      return { schedulerRows: updated };
    }),

  setSchedulerState: (machineId, state) =>
    set((s) => ({ schedulerState: { ...s.schedulerState, [machineId]: state } })),

  updateSchedulerCount: (machineId, rowId, count) =>
    set((state) => {
      const rows = state.schedulerRows[machineId];
      if (!rows) return state;
      const updated = rows.map((r) => r.id === rowId ? { ...r, count } : r);
      const updatedMap = { ...state.schedulerRows, [machineId]: updated };
      saveSchedulerRows(updatedMap);
      return { schedulerRows: updatedMap };
    }),

  setSchedulerError: (machineId, err) =>
    set((state) => ({ schedulerError: { ...state.schedulerError, [machineId]: err } })),

  clearSchedulerError: (machineId) =>
    set((state) => ({ schedulerError: { ...state.schedulerError, [machineId]: null } })),

  setDncConfig: (machineId, config) =>
    set((state) => {
      const updated = { ...state.dncConfigs, [machineId]: config };
      saveDncConfigs(updated);
      return { dncConfigs: updated };
    }),

  acquireControlLock: (machineId, username) =>
    set((state) => {
      const dur = state.controlLockDurationMin;
      return {
        controlLockMap: {
          ...state.controlLockMap,
          [machineId]: {
            isOwner: true,
            ownerUsername: username,
            expiresAt: Date.now() + dur * 60 * 1000,
          },
        },
      };
    }),

  releaseControlLock: (machineId) =>
    set((state) => {
      const updated = { ...state.controlLockMap };
      delete updated[machineId];
      return { controlLockMap: updated };
    }),

  extendControlLock: (machineId) =>
    set((state) => {
      const entry = state.controlLockMap[machineId];
      if (!entry?.isOwner) return state;
      const dur = state.controlLockDurationMin;
      return {
        controlLockMap: {
          ...state.controlLockMap,
          [machineId]: { ...entry, expiresAt: Date.now() + dur * 60 * 1000 },
        },
      };
    }),

  setControlLockDuration: (minutes) => {
    saveControlLockDuration(minutes);
    return set({ controlLockDurationMin: minutes });
  },

  updateOffsetEntry: (machineId, path, mode, no, field, value) =>
    set((state) => {
      const tel = state.telemetryMap[machineId];
      if (!tel?.offsetData) return state;
      const key = `${path}${mode.charAt(0).toUpperCase() + mode.slice(1)}` as keyof OffsetData;
      const entries = [...tel.offsetData[key]];
      const idx = entries.findIndex((e) => e.no === no);
      if (idx >= 0) entries[idx] = { ...entries[idx], [field]: value };
      return {
        telemetryMap: {
          ...state.telemetryMap,
          [machineId]: { ...tel, offsetData: { ...tel.offsetData, [key]: entries } },
        },
      };
    }),

  updateCountData: (machineId, updates) =>
    set((state) => {
      const tel = state.telemetryMap[machineId];
      if (!tel?.countData) return state;
      const counter = { ...tel.countData.counter };
      if (updates.counterOn !== undefined) counter.counterOn = updates.counterOn;
      if (updates.preset !== undefined) counter.preset = updates.preset;
      if (updates.resetCount) counter.count = 0;
      return {
        telemetryMap: {
          ...state.telemetryMap,
          [machineId]: { ...tel, countData: { ...tel.countData, counter } },
        },
      };
    }),

  updateToolLifeData: (machineId, updates) =>
    set((state) => {
      const tel = state.telemetryMap[machineId];
      if (!tel?.toolLifeData) return state;
      return {
        telemetryMap: {
          ...state.telemetryMap,
          [machineId]: { ...tel, toolLifeData: { ...tel.toolLifeData, ...updates } },
        },
      };
    }),

  updateToolLifePreset: (machineId, path, toolNo, preset) =>
    set((state) => {
      const tel = state.telemetryMap[machineId];
      if (!tel?.toolLifeData) return state;
      const key = path === 'path1' ? 'path1Tools' : 'path2Tools';
      const tools = tel.toolLifeData[key].map((t) =>
        t.toolNo === toolNo ? { ...t, preset } : t
      );
      return {
        telemetryMap: {
          ...state.telemetryMap,
          [machineId]: { ...tel, toolLifeData: { ...tel.toolLifeData, [key]: tools } },
        },
      };
    }),

  setLoading: (isLoading) =>
    set({ isLoading }),

  setError: (error) =>
    set({ error }),

  fetchMachines: async () => {
    try {
      const res = await machineApi.getAll();
      if (res.success && res.data?.items) {
        const serverMachines = res.data.items as Machine[];
        if (serverMachines.length > 0) {
          saveMachines(serverMachines);

          // Rebuild controlLockMap from server realtime data
          const { controlLockDurationMin } = get();
          const currentUserId = useAuthStore.getState().user?.id;
          const controlLockMap: Record<string, ControlLockEntry> = {};
          for (const m of serverMachines) {
            const lock = m.realtime?.controlLock;
            if (lock) {
              // Estimate expiry: acquiredAt + lock duration (server resets TTL on each extend)
              const acquiredMs = new Date(lock.acquiredAt).getTime();
              controlLockMap[m.machineId] = {
                isOwner: String(lock.ownerId) === String(currentUserId),
                ownerUsername: lock.ownerUsername,
                expiresAt: acquiredMs + controlLockDurationMin * 60 * 1000,
              };
            }
          }

          // Seed telemetryMap from REST response (initial data before WebSocket arrives)
          const initialTelemetry: Record<string, TelemetryData> = {};
          for (const m of serverMachines) {
            if (m.realtime?.telemetry) {
              initialTelemetry[m.machineId] = m.realtime.telemetry as TelemetryData;
            }
          }

          set({
            machines: serverMachines,
            controlLockMap,
            ...(Object.keys(initialTelemetry).length > 0 && { telemetryMap: initialTelemetry }),
          });

          // Re-subscribe WS to updated machine IDs
          if (wsClient.isConnected) {
            wsClient.subscribe(serverMachines.map((m) => m.machineId));
          }
        }
      }
    } catch {
      // Server unavailable — keep mock/localStorage
    }
  },

  initWebSocket: (token) => {
    // Skip in dev mode (no real server)
    if (!token || token === 'dev-token') return;

    // 기존 핸들러 정리 후 재등록 (HMR / 재호출 안전)
    _wsCleanups.forEach((fn) => fn());
    _wsCleanups = [];

    const cleanupConnect = wsClient.onConnect(() => {
        set({ wsConnected: true });
        // Subscribe to all currently known machines
        const machineIds = get().machines.map((m) => m.machineId);
        if (machineIds.length > 0) {
          wsClient.subscribe(machineIds);
        }
      });

    const cleanupDisconnect = wsClient.onDisconnect(() => {
      set({ wsConnected: false });
    });

    const cleanupMessage = wsClient.onMessage((msg) => {
        const store = get();
        switch (msg.type) {
          case 'telemetry': {
            const p = msg.payload as { machineId: string; data: TelemetryData };
            if (p?.machineId && p?.data) {
              store.updateTelemetry(p.machineId, p.data);
            }
            break;
          }
          case 'pmc_update': {
            // PMC 비트 빠른 업데이트 (100ms 주기) — pmcBits만 교체, 나머지 telemetry 유지
            const p = msg.payload as { machineId: string; pmcBits: Record<string, 0 | 1> };
            if (p?.machineId && p?.pmcBits) {
              store.updatePmcBits(p.machineId, p.pmcBits);
            }
            break;
          }
          case 'alarm': {
            const p = msg.payload as {
              machineId: string;
              alarmNo: number;
              alarmMsg: string;
              type: 'occurred' | 'cleared';
              category?: string;
              alarmTypeCode?: number;
            };
            if (!p?.machineId) break;
            if (p.type === 'occurred') {
              store.addAlarm(p.machineId, {
                id: `alarm-${Date.now()}-${p.alarmNo}`,
                alarmNo: p.alarmNo,
                alarmMsg: p.alarmMsg,
                category: p.category,
                occurredAt: msg.timestamp,
              });
            } else {
              store.clearAlarm(p.machineId, p.alarmNo);
            }
            break;
          }
          case 'event': {
            const p = msg.payload as { machineId: string; eventType: string } & Record<string, unknown>;
            if (!p?.machineId) break;
            const evtType = (p.eventType ?? '') as string;
            const evtMsg = formatSchedulerEventMessage(evtType, p);
            const evtLevel = getSchedulerEventLevel(evtType);
            store.addFocasEvent(p.machineId, {
              id: `evt-ws-${Date.now()}`,
              machineId: p.machineId,
              type: evtType as FocasEventType,
              message: evtMsg,
              level: evtLevel,
              details: p,
              timestamp: msg.timestamp,
            });
            break;
          }
          case 'command_result': {
            const p = msg.payload as {
              machineId: string;
              correlationId: string;
              status: 'success' | 'failure';
              errorCode?: string;
              errorMessage?: string;
            };
            if (p?.machineId) {
              store.addFocasEvent(p.machineId, {
                id: `cmd-${Date.now()}-${p.correlationId?.slice(0, 8)}`,
                machineId: p.machineId,
                type: 'COMMAND_RESULT' as FocasEventType,
                message: `명령 결과: ${p.status}`,
                details: msg.payload as Record<string, unknown>,
                timestamp: msg.timestamp,
              });
            }
            // CNC→PC 전송 실패 처리: correlationId = "xfer-{ts}-{fileName}"
            if (p?.status === 'failure' && p.correlationId?.startsWith('xfer-')) {
              const parts = p.correlationId.split('-');
              const fileName = parts.slice(2).join('-'); // "xfer-ts-O0170" → "O0170"
              const errMsg = p.errorCode === 'CNC_NOT_IN_EDIT_MODE'
                ? 'CNC를 EDIT 모드로 전환하세요'
                : (p.errorMessage ?? p.errorCode ?? '전송 실패');
              useFileStore.setState((fs) => ({
                transferQueue: fs.transferQueue.map((j) => {
                  if (j.direction !== 'CNC_TO_PC' || j.status === 'DONE' || j.status === 'ERROR') return j;
                  const jBase = j.fileName.replace(/\.nc$/i, '');
                  const eBase = fileName.replace(/\.nc$/i, '');
                  return jBase === eBase ? { ...j, status: 'ERROR' as const, error: errMsg } : j;
                }),
              }));
            }
            break;
          }
          case 'scheduler_update': {
            const p = msg.payload as { machineId: string; rows: SchedulerRow[] };
            if (p?.machineId) store.setSchedulerRows(p.machineId, p.rows ?? []);
            break;
          }
          case 'scheduler_count': {
            const p = msg.payload as { machineId: string; rowId: string; count: number };
            if (p?.machineId && p?.rowId && p?.count !== undefined) {
              store.updateSchedulerCount(p.machineId, p.rowId, p.count);
            }
            break;
          }
          case 'scheduler_state': {
            const p = msg.payload as { machineId: string; state: SchedulerState };
            if (p?.machineId && p?.state) {
              store.setSchedulerState(p.machineId, p.state);
              const stateMsg: Record<string, string> = {
                RUNNING: '스케줄러 실행 중',
                IDLE: '스케줄러 정지',
                PAUSED: '스케줄러 일시정지',
                ERROR: '스케줄러 오류 상태',
              };
              store.addFocasEvent(p.machineId, {
                id: `sched-state-${Date.now()}`,
                machineId: p.machineId,
                type: p.state === 'RUNNING' ? 'SCHEDULER_STARTED' : p.state === 'PAUSED' ? 'SCHEDULER_PAUSED' : 'SCHEDULER_STOPPED',
                message: stateMsg[p.state] ?? `스케줄러 상태: ${p.state}`,
                level: p.state === 'ERROR' ? 'error' : p.state === 'PAUSED' ? 'warn' : 'info',
                timestamp: msg.timestamp,
              });
            }
            break;
          }
          case 'scheduler_error': {
            const p = msg.payload as { machineId: string; rowId?: string; code: string; message: string };
            if (p?.machineId) {
              store.setSchedulerError(p.machineId, { rowId: p.rowId, code: p.code, message: p.message });
              // 이벤트 로그에도 추가 (에러/경고 색상)
              const isWarning = ['HEAD_TIMEOUT', 'ONE_CYCLE_STOP_TIMEOUT', 'COUNT_EXCEEDS_PRESET', 'INTERLOCK_FAIL'].includes(p.code);
              store.addFocasEvent(p.machineId, {
                id: `sched-err-${Date.now()}`,
                machineId: p.machineId,
                type: isWarning ? 'SCHEDULER_PAUSED' : 'SCHEDULER_ERROR',
                message: `[${p.code}] ${p.message}`,
                level: isWarning ? 'warn' : 'error',
                timestamp: msg.timestamp,
              });
            }
            break;
          }
          case 'file_downloaded': {
            // CNC→PC 파일 저장 완료 — PC 공용 저장소 목록 갱신 + 전송 큐 완료 처리
            const fdPayload = msg.payload as { machineId?: string; fileName?: string };
            const fdFileName = fdPayload?.fileName ?? '';
            const fileStore = useFileStore.getState();
            // share 목록 즉시 새로고침
            void fileStore.loadShareFiles();
            // 전송 큐에서 해당 파일 DONE 처리 (CNC_TO_PC 방향, TRANSFERRING 상태)
            useFileStore.setState((fs) => ({
              transferQueue: fs.transferQueue.map((j) => {
                if (j.direction !== 'CNC_TO_PC' || j.status === 'DONE' || j.status === 'ERROR') return j;
                // fileName 비교: "O0170" vs "O0170.nc" 등 확장자 무시
                const jBase = j.fileName.replace(/\.nc$/i, '');
                const eBase = fdFileName.replace(/\.nc$/i, '');
                return jBase === eBase ? { ...j, status: 'DONE' as const, progress: 100 } : j;
              }),
            }));
            break;
          }
          default:
            break;
        }
    });

    _wsCleanups = [cleanupConnect, cleanupDisconnect, cleanupMessage];

    // tokenGetter: 재연결 시마다 최신 accessToken 사용 (만료 후 갱신 대응)
    wsClient.connect(() => useAuthStore.getState().accessToken || '');
  },

  destroyWebSocket: () => {
    wsClient.disconnect();
    set({ wsConnected: false });
  },
}));

// Selectors
export const useSelectedMachine = () => {
  const machines = useMachineStore((state) => state.machines);
  const selectedMachineId = useMachineStore((state) => state.selectedMachineId);
  return machines.find((m) => m.machineId === selectedMachineId) || null;
};

export const useMachineTelemetry = (machineId: string) => {
  return useMachineStore((state) => state.telemetryMap[machineId]);
};

export const useMachineAlarms = (machineId: string) => {
  return useMachineStore((state) => state.activeAlarms[machineId] || []);
};

export const useFocasEvents = (machineId: string) => {
  return useMachineStore((state) => state.focasEvents[machineId] || []);
};

export const useSchedulerRows = (machineId: string) => {
  return useMachineStore((state) => state.schedulerRows[machineId] || []);
};

export const useSchedulerState = (machineId: string): SchedulerState => {
  return useMachineStore((state) => state.schedulerState[machineId] ?? 'IDLE');
};

export const useSchedulerError = (machineId: string) => {
  return useMachineStore((state) => state.schedulerError[machineId] ?? null);
};

export const useDncConfig = (machineId: string) => {
  return useMachineStore((state) => state.dncConfigs[machineId]);
};

export const useControlLock = (machineId: string) => {
  return useMachineStore((state) => state.controlLockMap[machineId]);
};

export const useControlLockDuration = () => {
  return useMachineStore((state) => state.controlLockDurationMin);
};

// ── 스케줄러 이벤트 메시지 포맷 헬퍼 ───────────────────────────────────────────

export function formatSchedulerEventMessage(eventType: string, p: Record<string, unknown>): string {
  switch (eventType) {
    case 'M20_COMPLETE':
      return `M20 완료 — ${p.programNo ?? ''} COUNT: ${p.count ?? ''}`;
    case 'SCHEDULER_STARTED':  return '스케줄러 시작';
    case 'SCHEDULER_STOPPED':  return '스케줄러 정지';
    case 'SCHEDULER_COMPLETED': return '스케줄러 전체 완료';
    case 'SCHEDULER_ROW_COMPLETED': return `행 완료 (rowId: ${(p.rowId as string)?.slice(0, 8) ?? ''})`;
    case 'SCHEDULER_PAUSED':
      return p.code ? `일시정지 [${p.code}]: ${p.message ?? ''}` : '스케줄러 일시정지';
    case 'SCHEDULER_ERROR':
      return `오류 [${p.code ?? ''}]: ${p.message ?? ''}`;
    case 'INTERLOCK_FAIL':    return '인터락 불만족 — 원사이클 스톱 ON';
    case 'ONE_CYCLE_STOP_ON': return '원사이클 스톱 ON';
    case 'ONE_CYCLE_STOP_OFF': return '원사이클 스톱 OFF';
    case 'HEAD_ON':           return `헤드 ON (${p.label ?? ''})`;
    default:                  return `${eventType}${p.message ? ` — ${p.message}` : ''}`;
  }
}

export function getSchedulerEventLevel(eventType: string): 'error' | 'warn' | 'info' {
  if (['SCHEDULER_ERROR', 'INTERLOCK_FAIL'].includes(eventType)) return 'error';
  if (['SCHEDULER_PAUSED', 'ONE_CYCLE_STOP_ON'].includes(eventType)) return 'warn';
  return 'info';
}

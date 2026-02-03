// Machine Store - Zustand

import { create } from 'zustand';

// Path 좌표 데이터 (CNC 자동선반 Path1/Path2)
export interface PathCoordinates {
  absolute: number[];      // ABSOLUTE [X, Y, Z, C]
  distanceToGo: number[];  // DISTANCE TO GO [X, Y, Z, C]
}

// 모달 G코드 정보 (활성 G코드 그리드 + F/M/T/S 값)
export interface ModalGCodeInfo {
  gCodeGrid: [string, string, string][];  // 5행 × 3열 G코드 그리드
  fProgrammed: number;   // F 프로그래밍 값
  mCode: number;         // 활성 M코드
  hOffset?: number;      // H 공구길이보정
  dOffset?: number;      // D 공구반경보정
  tTool: number;         // T 공구번호
  sProgrammed: number;   // S 프로그래밍 값
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
  | 'PROGRAM_SELECT'      // 프로그램 선택
  | 'CYCLE_START'         // 사이클 스타트
  | 'CYCLE_START_ACK'     // 사이클 스타트 실행 확인
  | 'FEED_HOLD'           // 피드 홀드
  | 'RESET'               // 리셋
  | 'ALARM_CLEAR'         // 알람 해제
  | 'MODE_CHANGE'         // 모드 변경
  | 'M20_COMPLETE'        // M20 카운트 완료
  | 'OVERRIDE_CHANGE'     // 오버라이드 변경
  | 'CONTROL_LOCK'        // 제어권 획득
  | 'CONTROL_UNLOCK'      // 제어권 해제
  | 'INTERLOCK_CHANGE'    // 인터록 상태 변경
  | 'COMMAND_SENT'        // 명령 전송
  | 'COMMAND_ACK';        // 명령 응답

// FOCAS 이벤트 로그
export interface FocasEvent {
  id: string;
  machineId: string;
  type: FocasEventType;
  message: string;
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
  pathCount: number;       // 2 또는 3
  dncPaths: DncPathConfig;
  updatedAt?: string;
  updatedBy?: string;
}

// 스케줄러 작업
export interface SchedulerJob {
  id: string;
  machineId: string;
  mainProgramNo: string;
  subProgramNo: string;
  preset: number;
  count: number;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
}

export interface Machine {
  id: string;
  machineId: string;
  name: string;
  ipAddress: string;
  port: number;
  isActive: boolean;
  pathCount?: number;  // 지원 Path 수 (기본 2, 최대 3)
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

interface MachineState {
  machines: Machine[];
  selectedMachineId: string | null;
  telemetryMap: Record<string, TelemetryData>;
  activeAlarms: Record<string, Alarm[]>;
  focasEvents: Record<string, FocasEvent[]>;  // FOCAS 이벤트 로그
  schedulerJobs: Record<string, SchedulerJob[]>;  // 스케줄러 작업 목록 (페이지 이동 시 유지)
  dncConfigs: Record<string, MachineDncConfig>;   // 장비별 DNC 경로 설정
  isLoading: boolean;
  error: string | null;

  // Actions
  setMachines: (machines: Machine[]) => void;
  selectMachine: (machineId: string | null) => void;
  updateTelemetry: (machineId: string, data: TelemetryData) => void;
  addAlarm: (machineId: string, alarm: Alarm) => void;
  clearAlarm: (machineId: string, alarmNo: number) => void;
  addFocasEvent: (machineId: string, event: FocasEvent) => void;
  clearFocasEvents: (machineId: string) => void;
  setSchedulerJobs: (machineId: string, jobs: SchedulerJob[]) => void;
  clearSchedulerJobs: (machineId: string) => void;
  setDncConfig: (machineId: string, config: MachineDncConfig) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

// Mock data for UI testing (used when backend is not available)
const MOCK_MACHINES: Machine[] = [
  {
    id: '1', machineId: 'MC-001', name: '1호기 자동선반', ipAddress: '192.168.1.101', port: 8193, isActive: true, pathCount: 2,
    template: { templateId: 'FANUC_0iTF_v1', name: 'FANUC 0i-TF', cncType: 'FANUC', seriesName: '0i-TF' },
    realtime: { status: 'online', telemetry: {
      runState: 2, mode: 'AUTO', programNo: 'O1001', subProgramNo: 'O9001', productName: 'SHAFT-A',
      feedrate: 120, spindleSpeed: 2500, spindleLoad: 42, partsCount: 87, presetCount: 100, cycleTime: 45, dailyRunRate: 78.5, alarmActive: false,
      absolutePosition: [125340, -45670, 89120, 0], machinePosition: [325340, -245670, 289120, 0]
    }},
  },
  {
    id: '2', machineId: 'MC-002', name: '2호기 자동선반', ipAddress: '192.168.1.102', port: 8193, isActive: true, pathCount: 2,
    template: { templateId: 'FANUC_0iTF_v1', name: 'FANUC 0i-TF', cncType: 'FANUC', seriesName: '0i-TF' },
    realtime: { status: 'online', telemetry: {
      runState: 0, mode: 'MDI', programNo: 'O1002', subProgramNo: 'O9002', productName: 'BOSS-B',
      feedrate: 0, spindleSpeed: 0, spindleLoad: 0, partsCount: 45, presetCount: 80, cycleTime: 0, dailyRunRate: 45.2, alarmActive: true,
      absolutePosition: [0, 0, 150000, 0], machinePosition: [200000, -200000, 350000, 0]
    }},
  },
  {
    id: '3', machineId: 'MC-003', name: '3호기 자동선반', ipAddress: '192.168.1.103', port: 8193, isActive: true, pathCount: 2,
    template: { templateId: 'FANUC_0iTF_v1', name: 'FANUC 0i-TF', cncType: 'FANUC', seriesName: '0i-TF' },
    realtime: { status: 'online', telemetry: {
      runState: 2, mode: 'AUTO', programNo: 'O1003', subProgramNo: 'O9003', productName: 'COLLAR-C',
      feedrate: 100, spindleSpeed: 3000, spindleLoad: 65, partsCount: 156, presetCount: 200, cycleTime: 38, dailyRunRate: 92.1, alarmActive: false,
      absolutePosition: [78900, -23450, 56780, 0], machinePosition: [278900, -223450, 256780, 0]
    }},
  },
  {
    id: '4', machineId: 'MC-004', name: '4호기 자동선반', ipAddress: '192.168.1.104', port: 8193, isActive: true, pathCount: 3,
    template: { templateId: 'FANUC_0iTF_v1', name: 'FANUC 0i-TF', cncType: 'FANUC', seriesName: '0i-TF' },
    realtime: { status: 'offline', telemetry: undefined },
  },
];

const MOCK_TELEMETRY: Record<string, TelemetryData> = {
  'MC-001': {
    runState: 2, mode: 'AUTO', programNo: 'O1001', subProgramNo: 'O9001', productName: 'SHAFT-A',
    feedrate: 120, spindleSpeed: 2500, spindleLoad: 42, partsCount: 87, presetCount: 100,
    cycleTime: 45, dailyRunRate: 78.5, alarmActive: false,
    absolutePosition: [125340, -45670, 89120, 0], machinePosition: [325340, -245670, 289120, 0],
    path1: {
      programNo: 'O1421', blockNo: 'N00020',
      programContent: ['M750 ;', '>M82;', '', 'M40;', 'M3S2500;', ''],
      currentLine: 1,
      coordinates: { absolute: [5500, 0, 20550, 32400], distanceToGo: [0, 0, 0, 0] },
      modal: {
        gCodeGrid: [['G00','G40','G54'],['G97','G25','G64'],['G69','G22','G18'],['G99','G80',''],['G21','G67','G40.1']],
        fProgrammed: 0.05, mCode: 9010, tTool: 1, sProgrammed: 10, hOffset: undefined, dOffset: undefined,
        feedActual: 0, repeatCurrent: 0, repeatTotal: 0, spindleActual: 10,
      },
      pathStatus: 'MEM STRT ---- ---',
    },
    path2: {
      programNo: 'O1402', blockNo: 'N00001',
      programContent: ['>M82;', '', 'G131B0.0(B5.0);', 'G02-5.0M14;', '', 'M68;'],
      currentLine: 0,
      coordinates: { absolute: [0, 0, 0, 38000], distanceToGo: [0, 0, 0, 0] },
      modal: {
        gCodeGrid: [['G00','G40','G54'],['G97','G25','G64'],['G69','G22','G18'],['G99','G80',''],['G21','G67','G40.1']],
        fProgrammed: 1.0, mCode: 995, tTool: 1, sProgrammed: 2000, hOffset: undefined, dOffset: undefined,
        feedActual: 0, repeatCurrent: 0, repeatTotal: 0, spindleActual: 157,
      },
      pathStatus: 'MEM STRT ---- ---',
    },
    interlock: { doorLock: true, memoryMode: true, barFeederAuto: true, coolantOn: true, machiningMode: false, cuttingMode: true }
  },
  'MC-002': {
    runState: 0, mode: 'MDI', programNo: 'O1002', subProgramNo: 'O9002', productName: 'BOSS-B',
    feedrate: 0, spindleSpeed: 0, spindleLoad: 0, partsCount: 45, presetCount: 80,
    cycleTime: 0, dailyRunRate: 45.2, alarmActive: true,
    absolutePosition: [0, 0, 150000, 0], machinePosition: [200000, -200000, 350000, 0],
    path1: {
      programNo: 'O1002', blockNo: 'N00001',
      programContent: ['>G28 U0 W0;', 'T0101;', 'G50 S3000;', 'G96 S200 M03;', 'G00 X50.0 Z2.0;', 'G01 Z0 F0.2;'],
      currentLine: 0,
      coordinates: { absolute: [0, 0, 150000, 0], distanceToGo: [0, 0, 0, 0] },
      modal: {
        gCodeGrid: [['G28','G40','G54'],['G97','G25','G64'],['G69','G22','G18'],['G99','G80',''],['G21','G67','G40.1']],
        fProgrammed: 0, mCode: 0, tTool: 0, sProgrammed: 0,
        feedActual: 0, repeatCurrent: 0, repeatTotal: 0, spindleActual: 0,
      },
      pathStatus: 'MDI **** ---- ---',
    },
    path2: {
      programNo: 'O9002', blockNo: 'N00001',
      programContent: ['>G28 U0 W0;', 'M30;', '', '', '', ''],
      currentLine: 0,
      coordinates: { absolute: [0, 0, 0, 0], distanceToGo: [0, 0, 0, 0] },
      modal: {
        gCodeGrid: [['G28','G40','G54'],['G97','G25','G64'],['G69','G22','G18'],['G99','G80',''],['G21','G67','G40.1']],
        fProgrammed: 0, mCode: 0, tTool: 0, sProgrammed: 0,
        feedActual: 0, repeatCurrent: 0, repeatTotal: 0, spindleActual: 0,
      },
      pathStatus: 'MDI **** ---- ---',
    },
    interlock: { doorLock: false, memoryMode: true, barFeederAuto: false, coolantOn: false, machiningMode: false, cuttingMode: false }
  },
  'MC-003': {
    runState: 2, mode: 'AUTO', programNo: 'O1003', subProgramNo: 'O9003', productName: 'COLLAR-C',
    feedrate: 100, spindleSpeed: 3000, spindleLoad: 65, partsCount: 156, presetCount: 200,
    cycleTime: 38, dailyRunRate: 92.1, alarmActive: false,
    absolutePosition: [78900, -23450, 56780, 0], machinePosition: [278900, -223450, 256780, 0],
    path1: {
      programNo: 'O1003', blockNo: 'N00200',
      programContent: ['G00 X40.0 Z2.0;', '>G01 X20.0 F0.12;', 'Z-40.0;', 'G02 X25.0 Z-45.0 R5.0;', 'G01 Z-60.0;', 'G00 X40.0;'],
      currentLine: 1,
      coordinates: { absolute: [20000, 0, -20000, 0], distanceToGo: [0, 0, 20000, 0] },
      modal: {
        gCodeGrid: [['G01','G40','G54'],['G97','G25','G64'],['G69','G22','G18'],['G99','G80',''],['G21','G67','G40.1']],
        fProgrammed: 0.12, mCode: 3, tTool: 1, sProgrammed: 3000,
        feedActual: 100, repeatCurrent: 0, repeatTotal: 0, spindleActual: 3000,
      },
      pathStatus: 'MEM STRT ---- ---',
    },
    path2: {
      programNo: 'O9003', blockNo: 'N00102',
      programContent: ['G00 X60.0 Z0;', '>G01 X50.0 F0.08;', 'Z-35.0;', 'X55.0;', 'G00 Z5.0;', 'X60.0;'],
      currentLine: 1,
      coordinates: { absolute: [50000, 0, -17500, 0], distanceToGo: [0, 0, 17500, 0] },
      modal: {
        gCodeGrid: [['G01','G40','G54'],['G97','G25','G64'],['G69','G22','G18'],['G99','G80',''],['G21','G67','G40.1']],
        fProgrammed: 0.08, mCode: 3, tTool: 1, sProgrammed: 2200,
        feedActual: 80, repeatCurrent: 0, repeatTotal: 0, spindleActual: 2200,
      },
      pathStatus: 'MEM STRT ---- ---',
    },
    interlock: { doorLock: true, memoryMode: true, barFeederAuto: true, coolantOn: true, machiningMode: false, cuttingMode: true }
  },
};

// Mock FOCAS 이벤트
const MOCK_FOCAS_EVENTS: Record<string, FocasEvent[]> = {
  'MC-001': [
    { id: 'evt-1', machineId: 'MC-001', type: 'PROGRAM_SELECT', message: '프로그램 O1001으로 변경되었습니다', timestamp: new Date(Date.now() - 300000).toISOString() },
    { id: 'evt-2', machineId: 'MC-001', type: 'CYCLE_START', message: '사이클스타트가 전송되었습니다', timestamp: new Date(Date.now() - 295000).toISOString() },
    { id: 'evt-3', machineId: 'MC-001', type: 'CYCLE_START_ACK', message: '사이클스타트가 실행되었습니다', timestamp: new Date(Date.now() - 294000).toISOString() },
    { id: 'evt-4', machineId: 'MC-001', type: 'M20_COMPLETE', message: '카운트가 완료되었습니다 (87/100)', details: { count: 87, preset: 100 }, timestamp: new Date(Date.now() - 60000).toISOString() },
  ],
};

// localStorage 헬퍼
const SCHEDULER_STORAGE_KEY = 'star-webcnc-scheduler-jobs';
const DNC_CONFIG_STORAGE_KEY = 'star-webcnc-dnc-config';

function loadSchedulerJobs(): Record<string, SchedulerJob[]> {
  try {
    const raw = localStorage.getItem(SCHEDULER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSchedulerJobs(jobs: Record<string, SchedulerJob[]>) {
  try {
    localStorage.setItem(SCHEDULER_STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // localStorage full or unavailable
  }
}

function loadDncConfigs(): Record<string, MachineDncConfig> {
  try {
    const raw = localStorage.getItem(DNC_CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
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

const MOCK_ALARMS: Record<string, Alarm[]> = {
  'MC-002': [
    { id: 'alarm-1', alarmNo: 1001, alarmMsg: 'SERVO ALARM: OVERLOAD', category: 'servo', occurredAt: new Date().toISOString() },
  ],
};

export const useMachineStore = create<MachineState>((set) => ({
  machines: MOCK_MACHINES,
  selectedMachineId: null,
  telemetryMap: MOCK_TELEMETRY,
  activeAlarms: MOCK_ALARMS,
  focasEvents: MOCK_FOCAS_EVENTS,
  schedulerJobs: loadSchedulerJobs(),
  dncConfigs: loadDncConfigs(),
  isLoading: false,
  error: null,

  setMachines: (machines) =>
    set({ machines }),

  selectMachine: (machineId) =>
    set({ selectedMachineId: machineId }),

  updateTelemetry: (machineId, data) =>
    set((state) => ({
      telemetryMap: {
        ...state.telemetryMap,
        [machineId]: data,
      },
    })),

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

  setSchedulerJobs: (machineId, jobs) =>
    set((state) => {
      const updated = { ...state.schedulerJobs, [machineId]: jobs };
      saveSchedulerJobs(updated);
      return { schedulerJobs: updated };
    }),

  clearSchedulerJobs: (machineId) =>
    set((state) => {
      const updated = { ...state.schedulerJobs, [machineId]: [] };
      saveSchedulerJobs(updated);
      return { schedulerJobs: updated };
    }),

  setDncConfig: (machineId, config) =>
    set((state) => {
      const updated = { ...state.dncConfigs, [machineId]: config };
      saveDncConfigs(updated);
      return { dncConfigs: updated };
    }),

  setLoading: (isLoading) =>
    set({ isLoading }),

  setError: (error) =>
    set({ error }),
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

export const useSchedulerJobs = (machineId: string) => {
  return useMachineStore((state) => state.schedulerJobs[machineId] || []);
};

export const useDncConfig = (machineId: string) => {
  return useMachineStore((state) => state.dncConfigs[machineId]);
};

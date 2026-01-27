// Machine Store - Zustand

import { create } from 'zustand';

export interface TelemetryData {
  runState: number;
  mode: string;
  programNo: string;
  subProgramNo?: string;       // 서브 프로그램 번호
  productName?: string;        // 제품명 (NC 코멘트에서 추출)
  feedrate: number;
  spindleSpeed: number;
  partsCount: number;
  presetCount?: number;        // 목표 수량 (PRESET)
  cycleTime?: number;          // 사이클타임 (초)
  dailyRunRate?: number;       // 일일 가동률 (%)
  alarmActive: boolean;
  absolutePosition?: number[];
  machinePosition?: number[];
}

export interface Machine {
  id: string;
  machineId: string;
  name: string;
  ipAddress: string;
  port: number;
  isActive: boolean;
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
  isLoading: boolean;
  error: string | null;

  // Actions
  setMachines: (machines: Machine[]) => void;
  selectMachine: (machineId: string | null) => void;
  updateTelemetry: (machineId: string, data: TelemetryData) => void;
  addAlarm: (machineId: string, alarm: Alarm) => void;
  clearAlarm: (machineId: string, alarmNo: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

// Mock data for UI testing (used when backend is not available)
const MOCK_MACHINES: Machine[] = [
  {
    id: '1', machineId: 'MC-001', name: '1호기 자동선반', ipAddress: '192.168.1.101', port: 8193, isActive: true,
    template: { templateId: 'FANUC_0iTF_v1', name: 'FANUC 0i-TF', cncType: 'FANUC', seriesName: '0i-TF' },
    realtime: { status: 'online', telemetry: {
      runState: 2, mode: 'AUTO', programNo: 'O1001', subProgramNo: 'O9001', productName: 'SHAFT-A',
      feedrate: 120, spindleSpeed: 2500, partsCount: 87, presetCount: 100, cycleTime: 45, dailyRunRate: 78.5, alarmActive: false
    }},
  },
  {
    id: '2', machineId: 'MC-002', name: '2호기 자동선반', ipAddress: '192.168.1.102', port: 8193, isActive: true,
    template: { templateId: 'FANUC_0iTF_v1', name: 'FANUC 0i-TF', cncType: 'FANUC', seriesName: '0i-TF' },
    realtime: { status: 'online', telemetry: {
      runState: 0, mode: 'MDI', programNo: 'O1002', subProgramNo: 'O9002', productName: 'BOSS-B',
      feedrate: 0, spindleSpeed: 0, partsCount: 45, presetCount: 80, cycleTime: 0, dailyRunRate: 45.2, alarmActive: true
    }},
  },
  {
    id: '3', machineId: 'MC-003', name: '3호기 자동선반', ipAddress: '192.168.1.103', port: 8193, isActive: true,
    template: { templateId: 'FANUC_0iTF_v1', name: 'FANUC 0i-TF', cncType: 'FANUC', seriesName: '0i-TF' },
    realtime: { status: 'online', telemetry: {
      runState: 2, mode: 'AUTO', programNo: 'O1003', subProgramNo: 'O9003', productName: 'COLLAR-C',
      feedrate: 100, spindleSpeed: 3000, partsCount: 156, presetCount: 200, cycleTime: 38, dailyRunRate: 92.1, alarmActive: false
    }},
  },
  {
    id: '4', machineId: 'MC-004', name: '4호기 자동선반', ipAddress: '192.168.1.104', port: 8193, isActive: true,
    template: { templateId: 'FANUC_0iTF_v1', name: 'FANUC 0i-TF', cncType: 'FANUC', seriesName: '0i-TF' },
    realtime: { status: 'offline', telemetry: undefined },
  },
];

const MOCK_TELEMETRY: Record<string, TelemetryData> = {
  'MC-001': { runState: 2, mode: 'AUTO', programNo: 'O1001', subProgramNo: 'O9001', productName: 'SHAFT-A', feedrate: 120, spindleSpeed: 2500, partsCount: 87, presetCount: 100, cycleTime: 45, dailyRunRate: 78.5, alarmActive: false },
  'MC-002': { runState: 0, mode: 'MDI', programNo: 'O1002', subProgramNo: 'O9002', productName: 'BOSS-B', feedrate: 0, spindleSpeed: 0, partsCount: 45, presetCount: 80, cycleTime: 0, dailyRunRate: 45.2, alarmActive: true },
  'MC-003': { runState: 2, mode: 'AUTO', programNo: 'O1003', subProgramNo: 'O9003', productName: 'COLLAR-C', feedrate: 100, spindleSpeed: 3000, partsCount: 156, presetCount: 200, cycleTime: 38, dailyRunRate: 92.1, alarmActive: false },
};

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

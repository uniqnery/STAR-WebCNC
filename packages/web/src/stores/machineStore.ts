// Machine Store - Zustand

import { create } from 'zustand';

export interface TelemetryData {
  runState: number;
  mode: string;
  programNo: string;
  feedrate: number;
  spindleSpeed: number;
  partsCount: number;
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

export const useMachineStore = create<MachineState>((set, get) => ({
  machines: [],
  selectedMachineId: null,
  telemetryMap: {},
  activeAlarms: {},
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

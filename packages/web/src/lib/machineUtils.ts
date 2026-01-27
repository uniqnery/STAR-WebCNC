// Machine Utility Functions

import { Machine, TelemetryData } from '../stores/machineStore';
import {
  STATUS_COLORS,
  STATUS_COLORS_HEX,
  STATUS_TEXT_COLORS,
  RUN_STATE,
  RUN_STATE_TEXT,
  MODE_TEXT,
} from './constants';
import type { MachineStatus, MachineStatsSummary } from './types';

/**
 * Determine machine status based on realtime data and telemetry
 */
export function getMachineStatus(machine: Machine): MachineStatus {
  if (!machine.realtime || machine.realtime.status === 'offline') {
    return 'offline';
  }

  const telemetry = machine.realtime.telemetry;
  if (!telemetry) {
    return 'offline';
  }

  if (telemetry.alarmActive) {
    return 'alarm';
  }

  if (telemetry.runState === RUN_STATE.START) {
    return 'running';
  }

  return 'idle';
}

/**
 * Get status from telemetry data directly
 */
export function getStatusFromTelemetry(
  telemetry: TelemetryData | undefined,
  isOnline: boolean = true
): MachineStatus {
  if (!isOnline || !telemetry) {
    return 'offline';
  }

  if (telemetry.alarmActive) {
    return 'alarm';
  }

  if (telemetry.runState === RUN_STATE.START) {
    return 'running';
  }

  return 'idle';
}

/**
 * Get Tailwind background color class for status
 */
export function getStatusColor(status: MachineStatus): string {
  return STATUS_COLORS[status];
}

/**
 * Get hex color for status (for SVG/canvas)
 */
export function getStatusColorHex(status: MachineStatus): string {
  return STATUS_COLORS_HEX[status];
}

/**
 * Get Tailwind text color class for status
 */
export function getStatusTextColor(status: MachineStatus): string {
  return STATUS_TEXT_COLORS[status];
}

/**
 * Get Korean text for status
 */
export function getStatusText(status: MachineStatus): string {
  const statusTextMap: Record<MachineStatus, string> = {
    running: '운전중',
    idle: '대기',
    alarm: '알람',
    offline: '오프라인',
  };
  return statusTextMap[status];
}

/**
 * Get Korean text for run state number
 */
export function getRunStateText(runState: number | undefined): string {
  if (runState === undefined) return '-';
  return RUN_STATE_TEXT[runState] || `상태 ${runState}`;
}

/**
 * Get Korean text for machine mode
 */
export function getModeText(mode: string | undefined): string {
  if (!mode) return '-';
  return MODE_TEXT[mode] || mode;
}

/**
 * Calculate machine statistics summary from machine list
 */
export function calculateMachineStats(machines: Machine[]): MachineStatsSummary {
  const stats: MachineStatsSummary = {
    total: machines.length,
    running: 0,
    idle: 0,
    alarm: 0,
    offline: 0,
  };

  machines.forEach((machine) => {
    const status = getMachineStatus(machine);
    stats[status]++;
  });

  return stats;
}

/**
 * Sort machines by machine number (호기)
 * Extracts number from name like "1호기", "2호기", etc.
 */
export function sortMachinesByNumber(machines: Machine[]): Machine[] {
  return [...machines].sort((a, b) => {
    const aNum = parseInt(a.name.match(/(\d+)호기/)?.[1] || '0');
    const bNum = parseInt(b.name.match(/(\d+)호기/)?.[1] || '0');
    return aNum - bNum;
  });
}

/**
 * Get machine by ID from list
 */
export function getMachineById(machines: Machine[], machineId: string): Machine | undefined {
  return machines.find((m) => m.machineId === machineId);
}

/**
 * Get machine name by ID
 */
export function getMachineName(machines: Machine[], machineId: string): string {
  const machine = getMachineById(machines, machineId);
  return machine?.name || machineId;
}

/**
 * Format cycle time from seconds to MM:SS
 */
export function formatCycleTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format large numbers with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('ko-KR');
}

// Shared Types

import { Machine, TelemetryData, Alarm } from '../stores/machineStore';

// Re-export for convenience
export type { Machine, TelemetryData, Alarm };

// Machine Status
export type MachineStatus = 'running' | 'idle' | 'alarm' | 'offline';

// Production Stats
export interface ProductionStats {
  machineId: string;
  machineName: string;
  totalParts: number;
  targetParts: number;
  runTime: number;
  idleTime: number;
  downTime: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

export interface ProductionChart {
  date: string;
  production: number;
  target: number;
}

// Alarm Types
export interface AlarmRecord {
  id: string;
  machineId: string;
  alarmNo: number;
  alarmMsg: string;
  alarmType: 'WARNING' | 'ALARM' | 'CRITICAL';
  occurredAt: string;
  clearedAt?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

// Scheduler Types
export interface SchedulerJob {
  id: string;
  machineId: string;
  programNo: string;
  targetCount: number;
  completedCount: number;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  oneCycleStop: boolean;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// File Transfer Types
export interface TransferFile {
  id: string;
  fileName: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  machineId?: string;
}

// Audit Log Types
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  username: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Machine Stats Summary
export interface MachineStatsSummary {
  total: number;
  running: number;
  idle: number;
  alarm: number;
  offline: number;
}

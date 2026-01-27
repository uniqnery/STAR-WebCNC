// Application Constants

// Machine Status Colors (Tailwind classes)
export const STATUS_COLORS = {
  running: 'bg-emerald-500',
  idle: 'bg-slate-400',
  alarm: 'bg-rose-500',
  offline: 'bg-gray-600',
} as const;

export const STATUS_COLORS_HEX = {
  running: '#10b981',  // emerald-500
  idle: '#94a3b8',     // slate-400
  alarm: '#f43f5e',    // rose-500
  offline: '#4b5563',  // gray-600
} as const;

export const STATUS_TEXT_COLORS = {
  running: 'text-emerald-500',
  idle: 'text-slate-400',
  alarm: 'text-rose-500',
  offline: 'text-gray-600',
} as const;

// Machine Run States (FANUC standard)
export const RUN_STATE = {
  STOP: 0,
  HOLD: 1,
  START: 2,
  MSTR: 3,
} as const;

export const RUN_STATE_TEXT: Record<number, string> = {
  [RUN_STATE.STOP]: '정지',
  [RUN_STATE.HOLD]: '일시정지',
  [RUN_STATE.START]: '운전중',
  [RUN_STATE.MSTR]: 'MSTR',
};

// Machine Modes
export const MODE_TEXT: Record<string, string> = {
  'AUTO': '자동',
  'MDI': 'MDI',
  'JOG': '수동',
  'EDIT': '편집',
  'REF': '원점복귀',
  'HANDLE': '핸들',
};

// WebSocket
export const WS_RECONNECT_DELAY = 5000;
export const WS_HEARTBEAT_INTERVAL = 30000;

// Zoom Controls
export const ZOOM = {
  MIN: 0.5,
  MAX: 3,
  STEP: 1.2,
} as const;

// API
export const API_TIMEOUT = 10000;

// Pagination
export const DEFAULT_PAGE_SIZE = 20;

// FOCAS 이벤트 로그 공용 컴포넌트
// Scheduler, RemoteControl 하단에서 동일하게 사용

import { FocasEvent } from '../stores/machineStore';

function getEventIcon(type: FocasEvent['type']): string {
  switch (type) {
    case 'CYCLE_START':
    case 'CYCLE_START_ACK':   return '▶';
    case 'FEED_HOLD':         return '⏸';
    case 'RESET':
    case 'ALARM_CLEAR':       return 'R';
    case 'PROGRAM_SELECT':    return 'P';
    case 'M20_COMPLETE':      return '✓';
    case 'CONTROL_LOCK':
    case 'CONTROL_UNLOCK':    return '🔒';
    case 'SCHEDULER_STARTED': return '▶';
    case 'SCHEDULER_STOPPED': return '■';
    case 'SCHEDULER_COMPLETED': return '✓✓';
    case 'SCHEDULER_ROW_COMPLETED': return '✓';
    case 'SCHEDULER_PAUSED':  return '⚠';
    case 'SCHEDULER_ERROR':   return '✕';
    case 'INTERLOCK_FAIL':    return '⚠';
    case 'ONE_CYCLE_STOP_ON': return '⏸';
    case 'ONE_CYCLE_STOP_OFF': return '▷';
    case 'HEAD_ON':           return '◉';
    default:                  return '·';
  }
}

function getRowStyle(event: FocasEvent): string {
  const level = event.level ?? getImpliedLevel(event.type);
  switch (level) {
    case 'error': return 'text-red-400 bg-red-950/30';
    case 'warn':  return 'text-yellow-300 bg-yellow-950/20';
    default:      return 'text-gray-300';
  }
}

function getImpliedLevel(type: FocasEvent['type']): 'error' | 'warn' | 'info' {
  if (['SCHEDULER_ERROR', 'INTERLOCK_FAIL'].includes(type)) return 'error';
  if (['SCHEDULER_PAUSED', 'ONE_CYCLE_STOP_ON'].includes(type)) return 'warn';
  return 'info';
}

export function FocasEventLog({ events }: { events: FocasEvent[] }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow flex flex-col h-full">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white px-4 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">이벤트 로그</h3>
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {events.length === 0 ? (
          <div className="text-center text-gray-500 py-4">이벤트 대기 중...</div>
        ) : (
          [...events].reverse().map((event) => (
            <div
              key={event.id}
              className={`flex items-center gap-2 px-1.5 h-6 shrink-0 ${getRowStyle(event)}`}
            >
              <span className="text-gray-500 tabular-nums w-[72px] shrink-0">
                {new Date(event.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="w-5 text-center shrink-0 opacity-70">{getEventIcon(event.type)}</span>
              <span className="flex-1 truncate">{event.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

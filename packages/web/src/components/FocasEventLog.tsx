// FOCAS 이벤트 로그 공용 컴포넌트
// Scheduler, RemoteControl 하단에서 동일하게 사용

import { FocasEvent } from '../stores/machineStore';

function getEventIcon(type: FocasEvent['type']) {
  switch (type) {
    case 'CYCLE_START':
    case 'CYCLE_START_ACK':
      return '>';
    case 'FEED_HOLD':
      return '||';
    case 'RESET':
    case 'ALARM_CLEAR':
      return 'R';
    case 'PROGRAM_SELECT':
      return 'P';
    case 'M20_COMPLETE':
      return 'v';
    case 'CONTROL_LOCK':
    case 'CONTROL_UNLOCK':
      return 'L';
    default:
      return '*';
  }
}

export function FocasEventLog({ events }: { events: FocasEvent[] }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">FOCAS 이벤트 로그</h3>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {events.length === 0 ? (
          <div className="text-center text-gray-500 py-4">이벤트 대기 중...</div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-3 text-sm py-1 border-b border-gray-100 dark:border-gray-700 last:border-0"
            >
              <span className="text-gray-400 font-mono text-xs w-20">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
              <span className="w-5 text-center">{getEventIcon(event.type)}</span>
              <span className="text-gray-700 dark:text-gray-300">{event.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

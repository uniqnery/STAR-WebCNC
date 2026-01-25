// Interlock Status Bar Component

import { useMachineTelemetry } from '../stores/machineStore';

interface InterlockBarProps {
  machineId: string;
}

interface InterlockCondition {
  name: string;
  status: 'ok' | 'blocked' | 'unknown';
  message: string;
}

export function InterlockBar({ machineId }: InterlockBarProps) {
  const telemetry = useMachineTelemetry(machineId);

  // Evaluate interlock conditions based on telemetry
  const conditions: InterlockCondition[] = [
    {
      name: '비상정지',
      status: telemetry?.runState === undefined ? 'unknown' :
              telemetry.runState === 0 ? 'ok' : 'ok', // Check emergency from status
      message: '비상정지 해제됨',
    },
    {
      name: '알람',
      status: telemetry?.alarmActive === undefined ? 'unknown' :
              telemetry.alarmActive ? 'blocked' : 'ok',
      message: telemetry?.alarmActive ? '알람 발생 중' : '알람 없음',
    },
    {
      name: '운전 상태',
      status: telemetry?.runState === undefined ? 'unknown' :
              telemetry.runState === 2 ? 'blocked' : 'ok',
      message: telemetry?.runState === 2 ? '가동 중 (제어 불가)' : '정지 상태',
    },
    {
      name: '모드',
      status: telemetry?.mode === undefined ? 'unknown' :
              ['MEM', 'MDI', 'EDIT'].includes(telemetry.mode) ? 'ok' : 'blocked',
      message: telemetry?.mode ? `${telemetry.mode} 모드` : '모드 확인 불가',
    },
  ];

  const allOk = conditions.every((c) => c.status === 'ok');
  const hasBlocked = conditions.some((c) => c.status === 'blocked');

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-white">
          인터락 상태
        </h3>
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            allOk
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : hasBlocked
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400'
          }`}
        >
          {allOk ? '제어 가능' : hasBlocked ? '제어 불가' : '확인 중'}
        </span>
      </div>

      <div className="space-y-2">
        {conditions.map((condition) => (
          <div
            key={condition.name}
            className="flex items-center justify-between py-1"
          >
            <div className="flex items-center gap-2">
              <StatusIndicator status={condition.status} />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {condition.name}
              </span>
            </div>
            <span className="text-xs text-gray-500">{condition.message}</span>
          </div>
        ))}
      </div>

      {hasBlocked && (
        <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600 dark:text-red-400">
          인터락 조건이 충족되지 않아 제어가 차단됩니다.
        </div>
      )}
    </div>
  );
}

function StatusIndicator({ status }: { status: 'ok' | 'blocked' | 'unknown' }) {
  const colors = {
    ok: 'bg-green-500',
    blocked: 'bg-red-500',
    unknown: 'bg-gray-400',
  };

  return (
    <span className={`w-2 h-2 rounded-full ${colors[status]}`} />
  );
}

// Machine Card Component

import { Machine, useMachineTelemetry } from '../stores/machineStore';

interface MachineCardProps {
  machine: Machine;
  isSelected: boolean;
  onSelect: (machineId: string) => void;
}

export function MachineCard({ machine, isSelected, onSelect }: MachineCardProps) {
  const telemetry = useMachineTelemetry(machine.machineId);
  const status = machine.realtime?.status || (telemetry ? 'online' : 'offline');

  const getStatusColor = () => {
    if (status === 'offline') return 'bg-gray-500';
    if (telemetry?.alarmActive) return 'bg-red-500';
    if (telemetry?.runState === 2) return 'bg-green-500'; // Running
    if (telemetry?.runState === 1) return 'bg-yellow-500'; // Hold
    return 'bg-blue-500'; // Idle
  };

  const getStatusText = () => {
    if (status === 'offline') return 'OFFLINE';
    if (telemetry?.alarmActive) return 'ALARM';
    if (telemetry?.runState === 2) return 'RUNNING';
    if (telemetry?.runState === 1) return 'HOLD';
    return 'IDLE';
  };

  const getModeText = () => {
    return telemetry?.mode || '-';
  };

  return (
    <div
      onClick={() => onSelect(machine.machineId)}
      className={`
        cursor-pointer rounded-lg border-2 p-4 transition-all
        ${isSelected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
        }
        hover:shadow-md
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            {machine.name}
          </h3>
        </div>
        <span className="text-xs font-mono text-gray-500">
          {machine.machineId}
        </span>
      </div>

      {/* Status */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="text-center p-2 bg-gray-100 dark:bg-gray-700 rounded">
          <div className="text-xs text-gray-500 dark:text-gray-400">상태</div>
          <div className={`text-sm font-bold ${
            status === 'offline' ? 'text-gray-500' :
            telemetry?.alarmActive ? 'text-red-600' :
            telemetry?.runState === 2 ? 'text-green-600' :
            'text-blue-600'
          }`}>
            {getStatusText()}
          </div>
        </div>
        <div className="text-center p-2 bg-gray-100 dark:bg-gray-700 rounded">
          <div className="text-xs text-gray-500 dark:text-gray-400">모드</div>
          <div className="text-sm font-bold text-gray-900 dark:text-white">
            {getModeText()}
          </div>
        </div>
      </div>

      {/* Program Info */}
      {telemetry && (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">프로그램</span>
            <span className="font-mono">{telemetry.programNo || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">스핀들</span>
            <span className="font-mono">{telemetry.spindleSpeed} rpm</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">이송속도</span>
            <span className="font-mono">{telemetry.feedrate} mm/min</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">가공수량</span>
            <span className="font-mono font-bold">{telemetry.partsCount}</span>
          </div>
        </div>
      )}

      {/* Control Lock */}
      {machine.realtime?.controlLock && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-1 text-xs text-orange-600">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <span>{machine.realtime.controlLock.ownerUsername} 제어 중</span>
          </div>
        </div>
      )}
    </div>
  );
}

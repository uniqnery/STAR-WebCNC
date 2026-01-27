// CardView Component - 장비별 상세 정보 카드

import { Machine } from '../stores/machineStore';
import {
  getStatusFromTelemetry,
  getStatusColor,
  getStatusText,
  sortMachinesByNumber,
  formatCycleTime,
} from '../lib/machineUtils';

interface CardViewProps {
  machines: Machine[];
  onSelectMachine: (machineId: string) => void;
}

export function CardView({ machines, onSelectMachine }: CardViewProps) {
  const sortedMachines = sortMachinesByNumber(machines);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {sortedMachines.map((machine) => (
        <MachineStatusCard
          key={machine.id}
          machine={machine}
          onClick={() => onSelectMachine(machine.machineId)}
        />
      ))}
    </div>
  );
}

export interface MachineStatusCardProps {
  machine: Machine;
  onClick?: () => void;
  compact?: boolean;
}

export function MachineStatusCard({ machine, onClick, compact = false }: MachineStatusCardProps) {
  const telemetry = machine.realtime?.telemetry;
  const isOnline = machine.realtime?.status === 'online';
  const status = getStatusFromTelemetry(telemetry, isOnline);
  const statusColorClass = getStatusColor(status);
  const statusTextStr = getStatusText(status);

  // 일일 가동률 색상
  const getRunRateColor = (rate?: number) => {
    if (rate === undefined) return 'text-gray-400';
    if (rate >= 80) return 'text-emerald-500';
    if (rate >= 50) return 'text-yellow-500';
    return 'text-rose-500';
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden
                 border border-gray-200 dark:border-gray-700
                 ${onClick ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''}`}
    >
      {/* 상태 표시 바 */}
      <div className={`h-2 ${statusColorClass}`} />

      {/* 헤더: 호기명 / 장비명 */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-white">
              {machine.name}
            </h3>
            <p className="text-xs text-gray-500">{machine.machineId}</p>
          </div>
          <span className={`px-2 py-1 text-xs font-medium rounded-full text-white ${statusColorClass}`}>
            {statusTextStr}
          </span>
        </div>
      </div>

      {/* 메인 데이터 */}
      <div className="p-4 space-y-3">
        {/* PRESET / COUNT */}
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">PRESET / COUNT</span>
            {telemetry?.presetCount && telemetry.partsCount !== undefined && (
              <span className="text-xs text-gray-400">
                {Math.round((telemetry.partsCount / telemetry.presetCount) * 100)}%
              </span>
            )}
          </div>
          <div className="text-xl font-mono font-bold text-gray-900 dark:text-white">
            <span className="text-gray-400">{telemetry?.presetCount ?? '-'}</span>
            <span className="text-gray-400 mx-1">/</span>
            <span className={status === 'running' ? 'text-emerald-500' : ''}>{telemetry?.partsCount ?? '-'}</span>
          </div>
          {/* 진행률 바 */}
          {telemetry?.presetCount && telemetry.partsCount !== undefined && (
            <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
              <div
                className={`h-full ${statusColorClass} transition-all`}
                style={{ width: `${Math.min((telemetry.partsCount / telemetry.presetCount) * 100, 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* 가동률 & 사이클타임 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">일일 가동률</div>
            <div className={`text-lg font-mono font-bold ${getRunRateColor(telemetry?.dailyRunRate)}`}>
              {telemetry?.dailyRunRate !== undefined ? `${telemetry.dailyRunRate.toFixed(1)}%` : '-'}
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">사이클타임</div>
            <div className="text-lg font-mono font-bold text-gray-900 dark:text-white">
              {telemetry?.cycleTime ? formatCycleTime(telemetry.cycleTime) : '--:--'}
            </div>
          </div>
        </div>

        {/* 프로그램 정보 */}
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">프로그램</div>
          <div className="space-y-1">
            {/* 메인 프로그램 */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">MAIN</span>
              <span className="font-mono font-semibold text-gray-900 dark:text-white">
                {telemetry?.programNo || '-'}
              </span>
            </div>
            {/* 서브 프로그램 */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">SUB</span>
              <span className="font-mono text-sm text-gray-600 dark:text-gray-300">
                {telemetry?.subProgramNo || '-'}
              </span>
            </div>
            {/* 제품명 */}
            {telemetry?.productName && (
              <div className="pt-1 mt-1 border-t border-gray-200 dark:border-gray-600">
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  ({telemetry.productName})
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 하단 정보 (compact 모드가 아닐 때만) */}
      {!compact && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>모드: {telemetry?.mode || '-'}</span>
            <span>스핀들: {telemetry?.spindleSpeed ? `${telemetry.spindleSpeed} RPM` : '-'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

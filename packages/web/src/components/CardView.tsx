// CardView Component - 장비별 상세 정보 카드 + Quick Action 팝오버

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Machine, useMachineStore } from '../stores/machineStore';
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
  const navigate = useNavigate();
  const { selectMachine } = useMachineStore();

  const [popoverMachineId, setPopoverMachineId] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverMachineId(null);
      }
    };
    if (popoverMachineId) {
      document.addEventListener('mousedown', handle);
    }
    return () => document.removeEventListener('mousedown', handle);
  }, [popoverMachineId]);

  const handleCardClick = (machine: Machine, e: React.MouseEvent) => {
    onSelectMachine(machine.machineId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopoverPos({ top: rect.top + rect.height / 2, left: rect.left + rect.width / 2 });
    setPopoverMachineId(machine.machineId);
  };

  const handleAction = (machineId: string, path: string) => {
    selectMachine(machineId);
    setPopoverMachineId(null);
    navigate(path);
  };

  const popoverMachine = popoverMachineId
    ? machines.find((m) => m.machineId === popoverMachineId)
    : null;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sortedMachines.map((machine) => (
          <MachineStatusCard
            key={machine.id}
            machine={machine}
            onClick={(e) => handleCardClick(machine, e)}
          />
        ))}
      </div>

      {/* Quick Action Popover */}
      {popoverMachine && (
        <div className="fixed inset-0 z-50" onClick={() => setPopoverMachineId(null)}>
          <div
            ref={popoverRef}
            className="absolute bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 w-44 animate-in fade-in zoom-in duration-150"
            style={{
              top: popoverPos.top,
              left: popoverPos.left,
              transform: 'translate(-50%, -50%)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 text-xs text-gray-500 font-medium border-b border-gray-100 dark:border-gray-700">
              {popoverMachine.name}
            </div>
            <button
              onClick={() => handleAction(popoverMachine.machineId, '/remote')}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ActionIcon d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              원격 조작반
            </button>
            <button
              onClick={() => handleAction(popoverMachine.machineId, '/scheduler')}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ActionIcon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              스케줄러
            </button>
            <button
              onClick={() => handleAction(popoverMachine.machineId, '/transfer')}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ActionIcon d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              파일 전송
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ActionIcon({ d }: { d: string }) {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  );
}

export interface MachineStatusCardProps {
  machine: Machine;
  onClick?: (e: React.MouseEvent) => void;
  compact?: boolean;
}

export function MachineStatusCard({ machine, onClick, compact = false }: MachineStatusCardProps) {
  // telemetryMap이 있으면 우선 사용 (WebSocket 실시간), 없으면 초기 API 값
  const liveData = useMachineStore((s) => s.telemetryMap[machine.machineId]);
  const telemetry = liveData ?? machine.realtime?.telemetry;
  const isOnline = liveData != null || machine.realtime?.status === 'online';
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
              {telemetry?.cycleTime != null && telemetry.cycleTime > 0 ? formatCycleTime(telemetry.cycleTime) : '--:--'}
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
                {telemetry?.path2?.programNo || '-'}
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

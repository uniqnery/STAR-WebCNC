// Machines Page - Machine List and Status Overview

import { useMachineStore, Machine } from '../stores/machineStore';
import { Link } from 'react-router-dom';
import {
  getMachineStatus,
  getStatusColor,
  getStatusText,
  getRunStateText,
} from '../lib/machineUtils';

export function Machines() {
  const { machines } = useMachineStore();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Machines</h1>
        <p className="text-gray-600 dark:text-gray-400">CNC 장비 목록 및 상태</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {machines.map((machine) => (
          <MachineListCard key={machine.id} machine={machine} />
        ))}
      </div>

      {machines.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-lg">등록된 장비가 없습니다</p>
          <p className="text-sm mt-2">관리자에게 문의하세요</p>
        </div>
      )}
    </div>
  );
}

function MachineListCard({ machine }: { machine: Machine }) {
  const telemetry = machine.realtime?.telemetry;
  const isOnline = machine.realtime?.status === 'online';
  const status = getMachineStatus(machine);
  const statusColorClass = getStatusColor(status);
  const statusTextStr = getStatusText(status);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {machine.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {machine.machineId}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${statusColorClass}`} />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
              {statusTextStr}
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {isOnline && telemetry ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Mode</span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {telemetry.mode}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Run State</span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {getRunStateText(telemetry.runState)}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Program</span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {telemetry.programNo || '-'}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Parts</span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {telemetry.partsCount}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200 dark:border-gray-600">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Feed</span>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {telemetry.feedrate} mm/min
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Spindle</span>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {telemetry.spindleSpeed} RPM
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-gray-500 dark:text-gray-400">
            <p>오프라인</p>
            <p className="text-sm mt-1">{machine.ipAddress}:{machine.port}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600">
        <div className="flex gap-2">
          <Link
            to={`/remote/${machine.machineId}`}
            className="flex-1 px-3 py-2 text-center text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
          >
            Remote
          </Link>
          <button
            className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
          >
            Details
          </button>
        </div>
      </div>
    </div>
  );
}

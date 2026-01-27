// Alarms Page - Alarm History and Real-time Monitoring

import { useState, useEffect, useCallback } from 'react';
import { useMachineStore } from '../stores/machineStore';
import { alarmApi } from '../lib/api';
import { useWebSocket } from '../hooks/useWebSocket';

interface AlarmRecord {
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

export function Alarms() {
  const machines = useMachineStore((state) => state.machines);
  const selectedMachineId = useMachineStore((state) => state.selectedMachineId);
  const { lastAlarm } = useWebSocket();

  const [alarms, setAlarms] = useState<AlarmRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'history'>('all');
  const [machineFilter, setMachineFilter] = useState<string>(selectedMachineId || '');

  // Load alarms
  const loadAlarms = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await alarmApi.getAlarms({
        machineId: machineFilter || undefined,
        active: filter === 'active' ? true : filter === 'history' ? false : undefined,
      });
      if (response.success && response.data) {
        setAlarms(response.data as AlarmRecord[]);
      }
    } catch (err) {
      console.error('Failed to load alarms:', err);
    } finally {
      setIsLoading(false);
    }
  }, [machineFilter, filter]);

  useEffect(() => {
    loadAlarms();
  }, [loadAlarms]);

  // Handle real-time alarm updates
  useEffect(() => {
    if (lastAlarm) {
      const newAlarm: AlarmRecord = {
        id: `temp-${Date.now()}`,
        machineId: lastAlarm.machineId,
        alarmNo: lastAlarm.alarmNo,
        alarmMsg: lastAlarm.alarmMsg,
        alarmType: lastAlarm.type === 'cleared' ? 'WARNING' : 'ALARM',
        occurredAt: new Date().toISOString(),
        clearedAt: lastAlarm.type === 'cleared' ? new Date().toISOString() : undefined,
      };

      if (lastAlarm.type === 'cleared') {
        // Mark alarm as cleared
        setAlarms((prev) =>
          prev.map((a) =>
            a.machineId === lastAlarm.machineId && a.alarmNo === lastAlarm.alarmNo && !a.clearedAt
              ? { ...a, clearedAt: new Date().toISOString() }
              : a
          )
        );
      } else {
        // Add new alarm
        setAlarms((prev) => [newAlarm, ...prev]);
      }
    }
  }, [lastAlarm]);

  // Acknowledge alarm
  const handleAcknowledge = async (alarmId: string) => {
    try {
      const response = await alarmApi.acknowledge(alarmId);
      if (response.success) {
        loadAlarms();
      }
    } catch (err) {
      console.error('Failed to acknowledge alarm:', err);
    }
  };

  // Get active alarms count per machine
  const activeAlarmCounts = machines.reduce((acc, machine) => {
    const count = alarms.filter(
      (a) => a.machineId === machine.machineId && !a.clearedAt
    ).length;
    acc[machine.machineId] = count;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          알람 관리
        </h1>
        <p className="text-gray-500">실시간 알람 모니터링 및 이력</p>
      </div>

      {/* Active Alarm Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
        {machines.map((machine) => (
          <ActiveAlarmCard
            key={machine.id}
            machineName={machine.name}
            count={activeAlarmCounts[machine.machineId] || 0}
            onClick={() => setMachineFilter(machine.machineId)}
            isSelected={machineFilter === machine.machineId}
          />
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        {/* Machine Filter */}
        <select
          value={machineFilter}
          onChange={(e) => setMachineFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                   bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="">모든 장비</option>
          {machines.map((machine) => (
            <option key={machine.id} value={machine.machineId}>
              {machine.name}
            </option>
          ))}
        </select>

        {/* Status Filter */}
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
          {(['all', 'active', 'history'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              {f === 'all' ? '전체' : f === 'active' ? '활성' : '이력'}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <button
          onClick={loadAlarms}
          className="px-4 py-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          새로고침
        </button>
      </div>

      {/* Alarms Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                시간
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                장비
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                알람번호
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                메시지
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                상태
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                작업
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  로딩 중...
                </td>
              </tr>
            ) : alarms.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  알람이 없습니다
                </td>
              </tr>
            ) : (
              alarms.map((alarm) => (
                <AlarmRow
                  key={alarm.id}
                  alarm={alarm}
                  machines={machines}
                  onAcknowledge={handleAcknowledge}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Active Alarm Card
function ActiveAlarmCard({
  machineName,
  count,
  onClick,
  isSelected,
}: {
  machineName: string;
  count: number;
  onClick: () => void;
  isSelected: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-lg text-left transition-colors ${
        isSelected
          ? 'bg-blue-100 dark:bg-blue-900/30 border-2 border-blue-500'
          : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300'
      } ${count > 0 ? 'shadow-md' : 'shadow'}`}
    >
      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
        {machineName}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {count > 0 ? (
          <>
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-red-600 font-bold">{count}</span>
          </>
        ) : (
          <>
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-green-600 text-sm">정상</span>
          </>
        )}
      </div>
    </button>
  );
}

// Alarm Row
function AlarmRow({
  alarm,
  machines,
  onAcknowledge,
}: {
  alarm: AlarmRecord;
  machines: any[];
  onAcknowledge: (id: string) => void;
}) {
  const machine = machines.find((m) => m.machineId === alarm.machineId);
  const isActive = !alarm.clearedAt;

  return (
    <tr className={`${isActive ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
      <td className="px-4 py-3 text-sm text-gray-500">
        {new Date(alarm.occurredAt).toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <span className="font-medium text-gray-900 dark:text-white">
          {machine?.name || alarm.machineId}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`font-mono font-bold ${isActive ? 'text-red-600' : 'text-gray-600'}`}>
          #{alarm.alarmNo}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-900 dark:text-white">
        {alarm.alarmMsg}
      </td>
      <td className="px-4 py-3">
        {isActive ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded text-xs font-medium">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            활성
          </span>
        ) : (
          <span className="px-2 py-1 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 rounded text-xs">
            해제됨
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        {isActive && !alarm.acknowledgedAt && (
          <button
            onClick={() => onAcknowledge(alarm.id)}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
          >
            확인
          </button>
        )}
        {alarm.acknowledgedAt && (
          <span className="text-xs text-gray-500">
            {alarm.acknowledgedBy}
          </span>
        )}
      </td>
    </tr>
  );
}

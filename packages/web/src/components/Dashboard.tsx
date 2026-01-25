// Dashboard Component

import { useEffect } from 'react';
import { useMachineStore } from '../stores/machineStore';
import { useWebSocket } from '../hooks/useWebSocket';
import { machineApi } from '../lib/api';
import { MachineCard } from './MachineCard';
import { MachineDetail } from './MachineDetail';

export function Dashboard() {
  const {
    machines,
    selectedMachineId,
    isLoading,
    error,
    setMachines,
    selectMachine,
    setLoading,
    setError,
  } = useMachineStore();

  const { isConnected, subscribe } = useWebSocket();

  // Load machines on mount
  useEffect(() => {
    const loadMachines = async () => {
      setLoading(true);
      try {
        const response = await machineApi.getAll();
        if (response.success && response.data) {
          setMachines(response.data.items as any[]);
        } else {
          setError(response.error?.message || '장비 목록을 불러올 수 없습니다.');
        }
      } catch (err) {
        setError('서버 연결에 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };

    loadMachines();
  }, []);

  // Subscribe to all machines when connected
  useEffect(() => {
    if (isConnected && machines.length > 0) {
      const machineIds = machines.map((m) => m.machineId);
      subscribe(machineIds);
    }
  }, [isConnected, machines, subscribe]);

  // Calculate summary stats
  const stats = {
    total: machines.length,
    running: machines.filter((m) => m.realtime?.telemetry?.runState === 2).length,
    idle: machines.filter((m) =>
      m.realtime?.status === 'online' &&
      !m.realtime?.telemetry?.alarmActive &&
      m.realtime?.telemetry?.runState !== 2
    ).length,
    alarm: machines.filter((m) => m.realtime?.telemetry?.alarmActive).length,
    offline: machines.filter((m) => m.realtime?.status === 'offline').length,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-red-500 text-lg mb-2">{error}</div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          대시보드
        </h1>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-sm text-gray-500">
            {isConnected ? '실시간 연결됨' : '연결 끊김'}
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <SummaryCard
          label="전체"
          value={stats.total}
          color="bg-gray-500"
        />
        <SummaryCard
          label="가동중"
          value={stats.running}
          color="bg-green-500"
        />
        <SummaryCard
          label="대기"
          value={stats.idle}
          color="bg-blue-500"
        />
        <SummaryCard
          label="알람"
          value={stats.alarm}
          color="bg-red-500"
        />
        <SummaryCard
          label="오프라인"
          value={stats.offline}
          color="bg-gray-400"
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Machine List */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
            장비 현황
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {machines.map((machine) => (
              <MachineCard
                key={machine.id}
                machine={machine}
                isSelected={machine.machineId === selectedMachineId}
                onSelect={selectMachine}
              />
            ))}
          </div>
        </div>

        {/* Machine Detail */}
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
            상세 정보
          </h2>
          {selectedMachineId ? (
            <MachineDetail machineId={selectedMachineId} />
          ) : (
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-8 text-center text-gray-500">
              장비를 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  color: string;
}

function SummaryCard({ label, value, color }: SummaryCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-10 rounded ${color}`} />
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {value}
          </div>
          <div className="text-sm text-gray-500">{label}</div>
        </div>
      </div>
    </div>
  );
}

// Dashboard Component

import { useEffect, useState } from 'react';
import { useMachineStore, Machine } from '../stores/machineStore';
import { useWebSocket } from '../hooks/useWebSocket';
import { machineApi } from '../lib/api';
import { CardView } from './CardView';
import { FactoryView } from './FactoryView';
import { calculateMachineStats } from '../lib/machineUtils';
import { STATUS_COLORS } from '../lib/constants';

type ViewMode = 'card' | 'factory';

export function Dashboard() {
  const [viewMode, setViewMode] = useState<ViewMode>('card');

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

  // Load machines on mount (skip if mock data already exists)
  useEffect(() => {
    if (machines.length > 0) {
      return;
    }

    const loadMachines = async () => {
      setLoading(true);
      try {
        const response = await machineApi.getAll();
        if (response.success && response.data) {
          const data = response.data as { items: Machine[] };
          setMachines(data.items);
        } else {
          setError(response.error?.message || '장비 목록을 불러올 수 없습니다.');
        }
      } catch {
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

  // Calculate summary stats using utility function
  const stats = calculateMachineStats(machines);

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

        <div className="flex items-center gap-4">
          {/* View Toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setViewMode('card')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'card'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              카드뷰
            </button>
            <button
              onClick={() => setViewMode('factory')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'factory'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              공장뷰
            </button>
          </div>

          {/* Connection Status */}
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
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <SummaryCard label="전체" value={stats.total} color="bg-slate-500" />
        <SummaryCard label="가동중" value={stats.running} color={STATUS_COLORS.running} />
        <SummaryCard label="대기" value={stats.idle} color={STATUS_COLORS.idle} />
        <SummaryCard label="알람" value={stats.alarm} color={STATUS_COLORS.alarm} />
        <SummaryCard label="오프라인" value={stats.offline} color={STATUS_COLORS.offline} />
      </div>

      {/* Main Content - View Based */}
      {viewMode === 'card' ? (
        <CardView machines={machines} onSelectMachine={selectMachine} />
      ) : (
        <FactoryView
          machines={machines}
          onSelectMachine={selectMachine}
          selectedMachineId={selectedMachineId}
        />
      )}
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

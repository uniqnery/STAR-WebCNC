// Scheduler Page - Job Scheduling and M20 Cycle Management

import { useState, useEffect, useCallback } from 'react';
import { useMachineStore } from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { schedulerApi } from '../lib/api';
import { useWebSocket } from '../hooks/useWebSocket';

interface SchedulerJob {
  id: string;
  machineId: string;
  programNo: string;
  targetCount: number;
  completedCount: number;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  oneCycleStop: boolean;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export function Scheduler() {
  const user = useAuthStore((state) => state.user);
  const machines = useMachineStore((state) => state.machines);
  const { lastM20Event } = useWebSocket();

  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Load jobs
  const loadJobs = useCallback(async () => {
    try {
      const response = await schedulerApi.getJobs();
      if (response.success && response.data) {
        setJobs(response.data as SchedulerJob[]);
      }
    } catch (err) {
      console.error('Failed to load jobs:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Update job counts when M20 event received
  useEffect(() => {
    if (lastM20Event) {
      setJobs((prev) =>
        prev.map((job) => {
          if (job.machineId === lastM20Event.machineId && job.status === 'RUNNING') {
            const newCount = job.completedCount + 1;
            return {
              ...job,
              completedCount: newCount,
              status: newCount >= job.targetCount ? 'COMPLETED' : 'RUNNING',
            };
          }
          return job;
        })
      );
    }
  }, [lastM20Event]);

  // Create job
  const handleCreateJob = async (data: {
    machineId: string;
    programNo: string;
    targetCount: number;
    oneCycleStop: boolean;
  }) => {
    setError(null);
    try {
      const response = await schedulerApi.createJob(data);
      if (response.success) {
        setShowCreateModal(false);
        loadJobs();
      } else {
        setError(response.error?.message || '작업 생성 실패');
      }
    } catch (err) {
      setError('서버 연결 오류');
    }
  };

  // Start job
  const handleStartJob = async (jobId: string) => {
    try {
      const response = await schedulerApi.startJob(jobId);
      if (response.success) {
        loadJobs();
      }
    } catch (err) {
      console.error('Failed to start job:', err);
    }
  };

  // Pause job
  const handlePauseJob = async (jobId: string) => {
    try {
      const response = await schedulerApi.pauseJob(jobId);
      if (response.success) {
        loadJobs();
      }
    } catch (err) {
      console.error('Failed to pause job:', err);
    }
  };

  // Cancel job
  const handleCancelJob = async (jobId: string) => {
    if (!confirm('이 작업을 취소하시겠습니까?')) return;

    try {
      const response = await schedulerApi.cancelJob(jobId);
      if (response.success) {
        loadJobs();
      }
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  };

  // One-cycle stop toggle
  const handleOneCycleStop = async (jobId: string, enabled: boolean) => {
    try {
      const response = await schedulerApi.setOneCycleStop(jobId, enabled);
      if (response.success) {
        loadJobs();
      }
    } catch (err) {
      console.error('Failed to toggle one-cycle stop:', err);
    }
  };

  const canManageScheduler = user?.role === 'ADMIN' || user?.role === 'AS';

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            스케줄러
          </h1>
          <p className="text-gray-500">작업 스케줄링 및 사이클 관리</p>
        </div>
        {canManageScheduler && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            + 새 작업
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Jobs Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                장비
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                프로그램
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                진행률
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                상태
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                1사이클정지
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
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  등록된 작업이 없습니다
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  machines={machines}
                  onStart={handleStartJob}
                  onPause={handlePauseJob}
                  onCancel={handleCancelJob}
                  onOneCycleStop={handleOneCycleStop}
                  canManage={canManageScheduler}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Recent M20 Events */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
          최근 M20 이벤트
        </h2>
        <M20EventLog machines={machines} />
      </div>

      {/* Create Job Modal */}
      {showCreateModal && (
        <CreateJobModal
          machines={machines}
          selectedMachine={selectedMachine}
          onSelectMachine={setSelectedMachine}
          onSubmit={handleCreateJob}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

// Job Row Component
function JobRow({
  job,
  machines,
  onStart,
  onPause,
  onCancel,
  onOneCycleStop,
  canManage,
}: {
  job: SchedulerJob;
  machines: any[];
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onCancel: (id: string) => void;
  onOneCycleStop: (id: string, enabled: boolean) => void;
  canManage: boolean;
}) {
  const machine = machines.find((m) => m.machineId === job.machineId);
  const progress = job.targetCount > 0
    ? Math.round((job.completedCount / job.targetCount) * 100)
    : 0;

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900 dark:text-white">
          {machine?.name || job.machineId}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-sm">
        {job.programNo}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-sm text-gray-500 min-w-[80px] text-right">
            {job.completedCount} / {job.targetCount}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={job.status} />
      </td>
      <td className="px-4 py-3">
        {job.status === 'RUNNING' && canManage ? (
          <button
            onClick={() => onOneCycleStop(job.id, !job.oneCycleStop)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              job.oneCycleStop
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {job.oneCycleStop ? 'ON' : 'OFF'}
          </button>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        {canManage && (
          <div className="flex items-center gap-2">
            {job.status === 'PENDING' && (
              <button
                onClick={() => onStart(job.id)}
                className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
              >
                시작
              </button>
            )}
            {job.status === 'RUNNING' && (
              <button
                onClick={() => onPause(job.id)}
                className="px-3 py-1 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600"
              >
                일시정지
              </button>
            )}
            {job.status === 'PAUSED' && (
              <button
                onClick={() => onStart(job.id)}
                className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
              >
                재개
              </button>
            )}
            {(job.status === 'PENDING' || job.status === 'PAUSED') && (
              <button
                onClick={() => onCancel(job.id)}
                className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
              >
                취소
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// Status Badge
function StatusBadge({ status }: { status: SchedulerJob['status'] }) {
  const styles = {
    PENDING: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    RUNNING: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    PAUSED: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    COMPLETED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  const labels = {
    PENDING: '대기',
    RUNNING: '실행 중',
    PAUSED: '일시정지',
    COMPLETED: '완료',
    CANCELLED: '취소됨',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// M20 Event Log
function M20EventLog({ machines }: { machines: any[] }) {
  const [events, setEvents] = useState<any[]>([]);
  const { lastM20Event } = useWebSocket();

  useEffect(() => {
    if (lastM20Event) {
      setEvents((prev) => [lastM20Event, ...prev].slice(0, 20));
    }
  }, [lastM20Event]);

  if (events.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center text-gray-500">
        대기 중...
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      <div className="max-h-64 overflow-y-auto">
        {events.map((event, i) => {
          const machine = machines.find((m) => m.machineId === event.machineId);
          return (
            <div
              key={i}
              className="flex items-center gap-4 px-4 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
            >
              <span className="w-32 text-sm text-gray-500 font-mono">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {machine?.name || event.machineId}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                프로그램: {event.programNo}
              </span>
              <span className="ml-auto text-sm font-medium text-blue-600">
                Count: {event.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Create Job Modal
function CreateJobModal({
  machines,
  selectedMachine,
  onSelectMachine,
  onSubmit,
  onClose,
}: {
  machines: any[];
  selectedMachine: string;
  onSelectMachine: (id: string) => void;
  onSubmit: (data: {
    machineId: string;
    programNo: string;
    targetCount: number;
    oneCycleStop: boolean;
  }) => void;
  onClose: () => void;
}) {
  const [programNo, setProgramNo] = useState('');
  const [targetCount, setTargetCount] = useState(100);
  const [oneCycleStop, setOneCycleStop] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMachine || !programNo || targetCount <= 0) return;

    onSubmit({
      machineId: selectedMachine,
      programNo,
      targetCount,
      oneCycleStop,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            새 작업 생성
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Machine Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              장비 선택
            </label>
            <select
              value={selectedMachine}
              onChange={(e) => onSelectMachine(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              required
            >
              <option value="">장비를 선택하세요</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.machineId}>
                  {machine.name}
                </option>
              ))}
            </select>
          </div>

          {/* Program Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              프로그램 번호
            </label>
            <input
              type="text"
              value={programNo}
              onChange={(e) => setProgramNo(e.target.value)}
              placeholder="O0001"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              required
            />
          </div>

          {/* Target Count */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              목표 수량
            </label>
            <input
              type="number"
              value={targetCount}
              onChange={(e) => setTargetCount(parseInt(e.target.value) || 0)}
              min="1"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              required
            />
          </div>

          {/* One Cycle Stop */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="oneCycleStop"
              checked={oneCycleStop}
              onChange={(e) => setOneCycleStop(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <label htmlFor="oneCycleStop" className="text-sm text-gray-700 dark:text-gray-300">
              목표 도달 시 1사이클 정지
            </label>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 dark:text-gray-400"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              생성
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

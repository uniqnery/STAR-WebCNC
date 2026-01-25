// Audit Log Page - System Activity Tracking

import { useState, useEffect, useCallback } from 'react';
import { useMachineStore } from '../stores/machineStore';
import { auditApi } from '../lib/api';

interface AuditLogEntry {
  id: string;
  userId: string;
  username: string;
  userRole: string;
  action: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  params?: Record<string, unknown>;
  result: 'success' | 'failure';
  errorMsg?: string;
  ipAddress: string;
  createdAt: string;
}

type ActionFilter = 'all' | 'control' | 'scheduler' | 'transfer' | 'auth' | 'admin';

export function AuditLog() {
  const machines = useMachineStore((state) => state.machines);

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [machineFilter, setMachineFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [dateRange, setDateRange] = useState({
    start: '',
    end: '',
  });

  // Load audit logs
  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await auditApi.getLogs({
        page,
        limit: 50,
        action: actionFilter === 'all' ? undefined : actionFilter,
        targetId: machineFilter || undefined,
        userId: userFilter || undefined,
        startDate: dateRange.start || undefined,
        endDate: dateRange.end || undefined,
      });
      if (response.success && response.data) {
        const data = response.data as { items: AuditLogEntry[]; totalPages: number };
        setLogs(data.items);
        setTotalPages(data.totalPages);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [page, actionFilter, machineFilter, userFilter, dateRange]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Get action category color
  const getActionColor = (action: string) => {
    if (action.startsWith('control.')) return 'text-blue-600 bg-blue-100 dark:bg-blue-900/30';
    if (action.startsWith('scheduler.')) return 'text-purple-600 bg-purple-100 dark:bg-purple-900/30';
    if (action.startsWith('transfer.')) return 'text-green-600 bg-green-100 dark:bg-green-900/30';
    if (action.startsWith('auth.')) return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30';
    if (action.startsWith('admin.')) return 'text-red-600 bg-red-100 dark:bg-red-900/30';
    return 'text-gray-600 bg-gray-100 dark:bg-gray-700';
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          감사 로그
        </h1>
        <p className="text-gray-500">시스템 활동 이력 조회</p>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          {/* Action Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">활동 유형</label>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value as ActionFilter);
                setPage(1);
              }}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            >
              <option value="all">전체</option>
              <option value="control">제어</option>
              <option value="scheduler">스케줄러</option>
              <option value="transfer">전송</option>
              <option value="auth">인증</option>
              <option value="admin">관리</option>
            </select>
          </div>

          {/* Machine Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">장비</label>
            <select
              value={machineFilter}
              onChange={(e) => {
                setMachineFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            >
              <option value="">전체 장비</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.machineId}>
                  {machine.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">시작일</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => {
                setDateRange({ ...dateRange, start: e.target.value });
                setPage(1);
              }}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">종료일</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => {
                setDateRange({ ...dateRange, end: e.target.value });
                setPage(1);
              }}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
          </div>

          {/* Refresh */}
          <button
            onClick={loadLogs}
            className="px-4 py-2 text-blue-600 hover:text-blue-700 text-sm"
          >
            새로고침
          </button>

          {/* Reset */}
          <button
            onClick={() => {
              setActionFilter('all');
              setMachineFilter('');
              setUserFilter('');
              setDateRange({ start: '', end: '' });
              setPage(1);
            }}
            className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm"
          >
            필터 초기화
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                시간
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                사용자
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                활동
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                대상
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                결과
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                IP
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
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  로그가 없습니다
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {log.username}
                    </div>
                    <div className="text-xs text-gray-500">{log.userRole}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                      {formatAction(log.action)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {log.targetName || log.targetId || '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {log.result === 'success' ? (
                      <span className="text-green-600">성공</span>
                    ) : (
                      <span className="text-red-600" title={log.errorMsg}>
                        실패
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">
                    {log.ipAddress}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              페이지 {page} / {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded
                         disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                이전
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded
                         disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Format action string for display
function formatAction(action: string): string {
  const actionMap: Record<string, string> = {
    'control.acquire': '제어권 획득',
    'control.release': '제어권 반납',
    'control.command': '명령 전송',
    'scheduler.start': '스케줄러 시작',
    'scheduler.pause': '스케줄러 일시정지',
    'scheduler.cancel': '스케줄러 취소',
    'scheduler.create': '작업 생성',
    'transfer.upload': '프로그램 업로드',
    'transfer.download': '프로그램 다운로드',
    'transfer.backup': '백업 생성',
    'auth.login': '로그인',
    'auth.logout': '로그아웃',
    'admin.user.create': '사용자 생성',
    'admin.user.update': '사용자 수정',
    'admin.machine.create': '장비 등록',
    'admin.machine.update': '장비 수정',
  };

  return actionMap[action] || action;
}

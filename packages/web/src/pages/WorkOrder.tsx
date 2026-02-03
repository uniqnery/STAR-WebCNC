// Work Order Page - MES Integration

import { useState, useEffect, useCallback } from 'react';
import { useMachineStore } from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { workOrderApi } from '../lib/api';

type WorkOrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

interface WorkOrder {
  id: string;
  orderNumber: string;
  productCode: string;
  productName: string;
  targetQuantity: number;
  producedQty: number;
  assignedMachine?: string;
  assignedMachineName?: string;
  programNumber?: string;
  priority: number;
  status: WorkOrderStatus;
  scheduledStart?: string;
  scheduledEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  createdAt: string;
}

// --- Mock Data ---
const MOCK_WORK_ORDERS: WorkOrder[] = [
  {
    id: 'wo-001', orderNumber: 'WO-2026-0201', productCode: 'SFT-A100', productName: '정밀 샤프트 A100',
    targetQuantity: 500, producedQty: 487, assignedMachine: 'SR-38B-01', assignedMachineName: 'SR-38B #1',
    programNumber: 'O1001', priority: 3, status: 'IN_PROGRESS',
    scheduledStart: '2026-02-01T08:00:00Z', scheduledEnd: '2026-02-03T18:00:00Z',
    actualStart: '2026-02-01T08:15:00Z', createdAt: '2026-01-30T10:00:00Z',
  },
  {
    id: 'wo-002', orderNumber: 'WO-2026-0202', productCode: 'PIN-B200', productName: '커넥터 핀 B200',
    targetQuantity: 2000, producedQty: 0, assignedMachine: 'SR-20J-01', assignedMachineName: 'SR-20J #1',
    programNumber: 'O2010', priority: 2, status: 'PENDING',
    scheduledStart: '2026-02-04T08:00:00Z', scheduledEnd: '2026-02-06T18:00:00Z',
    createdAt: '2026-01-31T14:00:00Z',
  },
  {
    id: 'wo-003', orderNumber: 'WO-2026-0203', productCode: 'BUSH-C50', productName: '부싱 C50',
    targetQuantity: 300, producedQty: 300, assignedMachine: 'SR-20J-02', assignedMachineName: 'SR-20J #2',
    programNumber: 'O3005', priority: 1, status: 'COMPLETED',
    scheduledStart: '2026-01-28T08:00:00Z', scheduledEnd: '2026-01-30T18:00:00Z',
    actualStart: '2026-01-28T08:05:00Z', actualEnd: '2026-01-30T15:30:00Z',
    createdAt: '2026-01-27T09:00:00Z',
  },
  {
    id: 'wo-004', orderNumber: 'WO-2026-0204', productCode: 'NUT-D10', productName: '정밀 너트 D10',
    targetQuantity: 1000, producedQty: 350, assignedMachine: 'SR-38B-02', assignedMachineName: 'SR-38B #2',
    programNumber: 'O4020', priority: 3, status: 'IN_PROGRESS',
    scheduledStart: '2026-02-02T08:00:00Z', scheduledEnd: '2026-02-05T18:00:00Z',
    actualStart: '2026-02-02T08:20:00Z', createdAt: '2026-02-01T11:00:00Z',
  },
  {
    id: 'wo-005', orderNumber: 'WO-2026-0205', productCode: 'RING-E30', productName: '씰링 E30',
    targetQuantity: 800, producedQty: 120, assignedMachine: 'SR-20J-01', assignedMachineName: 'SR-20J #1',
    programNumber: 'O5015', priority: 2, status: 'CANCELLED',
    scheduledStart: '2026-01-29T08:00:00Z', scheduledEnd: '2026-01-31T18:00:00Z',
    actualStart: '2026-01-29T08:10:00Z', createdAt: '2026-01-28T16:00:00Z',
  },
  {
    id: 'wo-006', orderNumber: 'WO-2026-0206', productCode: 'BOLT-F15', productName: '특수 볼트 F15',
    targetQuantity: 1500, producedQty: 0, priority: 1, status: 'PENDING',
    scheduledStart: '2026-02-07T08:00:00Z', scheduledEnd: '2026-02-10T18:00:00Z',
    createdAt: '2026-02-02T09:30:00Z',
  },
];

export function WorkOrder() {
  const user = useAuthStore((state) => state.user);
  const machines = useMachineStore((state) => state.machines);

  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | 'ALL'>('ALL');
  const [error, setError] = useState<string | null>(null);

  const canManage = user?.role === 'ADMIN' || user?.role === 'AS';

  // Load work orders
  const loadOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await workOrderApi.getAll(
        statusFilter === 'ALL' ? undefined : statusFilter
      );
      if (response.success && response.data) {
        setOrders(response.data as WorkOrder[]);
      } else {
        // Fallback to mock data
        const filtered = statusFilter === 'ALL'
          ? MOCK_WORK_ORDERS
          : MOCK_WORK_ORDERS.filter((o) => o.status === statusFilter);
        setOrders(filtered);
      }
    } catch (err) {
      console.error('Failed to load work orders:', err);
      const filtered = statusFilter === 'ALL'
        ? MOCK_WORK_ORDERS
        : MOCK_WORK_ORDERS.filter((o) => o.status === statusFilter);
      setOrders(filtered);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Start work order
  const handleStart = async (orderId: string) => {
    try {
      const response = await workOrderApi.start(orderId);
      if (response.success) {
        loadOrders();
      } else {
        setError(response.error?.message || '시작 실패');
      }
    } catch (err) {
      setError('서버 연결 오류');
    }
  };

  // Complete work order
  const handleComplete = async (orderId: string) => {
    try {
      const response = await workOrderApi.complete(orderId);
      if (response.success) {
        loadOrders();
      } else {
        setError(response.error?.message || '완료 처리 실패');
      }
    } catch (err) {
      setError('서버 연결 오류');
    }
  };

  // Cancel work order
  const handleCancel = async (orderId: string) => {
    if (!confirm('이 작업지시를 취소하시겠습니까?')) return;

    try {
      const response = await workOrderApi.cancel(orderId);
      if (response.success) {
        loadOrders();
      } else {
        setError(response.error?.message || '취소 실패');
      }
    } catch (err) {
      setError('서버 연결 오류');
    }
  };

  // Create work order
  const handleCreate = async (data: Partial<WorkOrder>) => {
    try {
      const response = await workOrderApi.create(data);
      if (response.success) {
        setShowCreateModal(false);
        loadOrders();
      } else {
        setError(response.error?.message || '생성 실패');
      }
    } catch (err) {
      setError('서버 연결 오류');
    }
  };

  // Stats
  const stats = {
    total: orders.length,
    pending: orders.filter((o) => o.status === 'PENDING').length,
    inProgress: orders.filter((o) => o.status === 'IN_PROGRESS').length,
    completed: orders.filter((o) => o.status === 'COMPLETED').length,
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            작업지시 (MES)
          </h1>
          <p className="text-gray-500">작업지시 관리 및 스케줄러 연동</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + 새 작업지시
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-700 hover:text-red-900">
            ✕
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="전체" value={stats.total} color="gray" />
        <StatCard label="대기" value={stats.pending} color="yellow" />
        <StatCard label="진행 중" value={stats.inProgress} color="blue" />
        <StatCard label="완료" value={stats.completed} color="green" />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
          {(['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100'
              }`}
            >
              {status === 'ALL' ? '전체' : getStatusLabel(status)}
            </button>
          ))}
        </div>
        <button
          onClick={loadOrders}
          className="text-blue-600 hover:text-blue-700 text-sm"
        >
          새로고침
        </button>
      </div>

      {/* Orders Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                작업지시번호
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                제품
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                장비
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                진행률
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                우선순위
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                상태
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                예정일
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                작업
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  로딩 중...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  작업지시가 없습니다
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3">
                    <span className="font-mono font-medium text-gray-900 dark:text-white">
                      {order.orderNumber}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-900 dark:text-white">{order.productName}</div>
                    <div className="text-xs text-gray-500">{order.productCode}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {order.assignedMachineName || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-20 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{
                            width: `${Math.min((order.producedQty / order.targetQuantity) * 100, 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">
                        {order.producedQty}/{order.targetQuantity}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <PriorityBadge priority={order.priority} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {order.scheduledStart
                      ? new Date(order.scheduledStart).toLocaleDateString()
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    {canManage && (
                      <div className="flex items-center justify-center gap-2">
                        {order.status === 'PENDING' && (
                          <button
                            onClick={() => handleStart(order.id)}
                            className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                          >
                            시작
                          </button>
                        )}
                        {order.status === 'IN_PROGRESS' && (
                          <button
                            onClick={() => handleComplete(order.id)}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                          >
                            완료
                          </button>
                        )}
                        {(order.status === 'PENDING' || order.status === 'IN_PROGRESS') && (
                          <button
                            onClick={() => handleCancel(order.id)}
                            className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                          >
                            취소
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateWorkOrderModal
          machines={machines}
          onSubmit={handleCreate}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

// Stat Card
function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'gray' | 'yellow' | 'blue' | 'green';
}) {
  const colors = {
    gray: 'bg-gray-100 dark:bg-gray-700',
    yellow: 'bg-yellow-100 dark:bg-yellow-900/30',
    blue: 'bg-blue-100 dark:bg-blue-900/30',
    green: 'bg-green-100 dark:bg-green-900/30',
  };

  const textColors = {
    gray: 'text-gray-600 dark:text-gray-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    blue: 'text-blue-600 dark:text-blue-400',
    green: 'text-green-600 dark:text-green-400',
  };

  return (
    <div className={`p-4 rounded-lg ${colors[color]}`}>
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${textColors[color]}`}>{value}</div>
    </div>
  );
}

// Status Badge
function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const styles: Record<WorkOrderStatus, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status]}`}>
      {getStatusLabel(status)}
    </span>
  );
}

function getStatusLabel(status: WorkOrderStatus): string {
  const labels: Record<WorkOrderStatus, string> = {
    PENDING: '대기',
    IN_PROGRESS: '진행 중',
    COMPLETED: '완료',
    CANCELLED: '취소',
  };
  return labels[status];
}

// Priority Badge
function PriorityBadge({ priority }: { priority: number }) {
  if (priority >= 3) {
    return <span className="text-red-600 font-bold">높음</span>;
  }
  if (priority >= 2) {
    return <span className="text-yellow-600">중간</span>;
  }
  return <span className="text-gray-500">낮음</span>;
}

// Create Work Order Modal
function CreateWorkOrderModal({
  machines,
  onSubmit,
  onClose,
}: {
  machines: any[];
  onSubmit: (data: any) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    orderNumber: '',
    productCode: '',
    productName: '',
    targetQuantity: 100,
    assignedMachine: '',
    programNumber: '',
    priority: 1,
    scheduledStart: '',
    scheduledEnd: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      targetQuantity: Number(formData.targetQuantity),
      priority: Number(formData.priority),
      assignedMachine: formData.assignedMachine || undefined,
      programNumber: formData.programNumber || undefined,
      scheduledStart: formData.scheduledStart || undefined,
      scheduledEnd: formData.scheduledEnd || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-auto">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            새 작업지시 생성
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                작업지시번호 *
              </label>
              <input
                type="text"
                value={formData.orderNumber}
                onChange={(e) => setFormData({ ...formData, orderNumber: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                제품코드 *
              </label>
              <input
                type="text"
                value={formData.productCode}
                onChange={(e) => setFormData({ ...formData, productCode: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              제품명
            </label>
            <input
              type="text"
              value={formData.productName}
              onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                목표 수량 *
              </label>
              <input
                type="number"
                value={formData.targetQuantity}
                onChange={(e) => setFormData({ ...formData, targetQuantity: parseInt(e.target.value) || 0 })}
                min="1"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                우선순위
              </label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value={1}>낮음</option>
                <option value={2}>중간</option>
                <option value={3}>높음</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                배정 장비
              </label>
              <select
                value={formData.assignedMachine}
                onChange={(e) => setFormData({ ...formData, assignedMachine: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">미배정</option>
                {machines.map((machine) => (
                  <option key={machine.id} value={machine.machineId}>
                    {machine.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                프로그램 번호
              </label>
              <input
                type="text"
                value={formData.programNumber}
                onChange={(e) => setFormData({ ...formData, programNumber: e.target.value })}
                placeholder="O0001"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                예정 시작일
              </label>
              <input
                type="date"
                value={formData.scheduledStart}
                onChange={(e) => setFormData({ ...formData, scheduledStart: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                예정 완료일
              </label>
              <input
                type="date"
                value={formData.scheduledEnd}
                onChange={(e) => setFormData({ ...formData, scheduledEnd: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

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

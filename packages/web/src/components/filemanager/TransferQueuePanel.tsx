// TransferQueuePanel - 하단 전송 큐/이력 표시 (다크 테마)
// - 고정 높이 영역 (빈 상태에서도 유지)
// - 작업 시각 + 작업자 메타데이터 표시
// - 관리자만 이력 삭제 가능

import { useFileStore } from '../../stores/fileStore';
import { useAuthStore } from '../../stores/authStore';
import type { TransferJob } from '../../stores/fileStore';

// 전송 큐 고정 높이 (px)
const QUEUE_HEIGHT_PX = 140;

export function TransferQueuePanel() {
  const transferQueue = useFileStore((s) => s.transferQueue);
  const clearCompletedTransfers = useFileStore((s) => s.clearCompletedTransfers);
  const user = useAuthStore((s) => s.user);

  const isAdmin = user?.role === 'ADMIN';
  const hasCompleted = transferQueue.some((j) => j.status === 'DONE' || j.status === 'ERROR');

  return (
    <div className="bg-gray-900 rounded-lg shadow mt-3 flex flex-col flex-shrink-0" style={{ height: QUEUE_HEIGHT_PX }}>
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-300">
          전송 이력 ({transferQueue.length})
        </span>
        {hasCompleted && (
          isAdmin ? (
            <button
              onClick={clearCompletedTransfers}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              완료 항목 지우기
            </button>
          ) : (
            <span className="text-xs text-gray-600">관리자만 삭제 가능</span>
          )
        )}
      </div>

      {/* 큐 목록 - 내부 스크롤 */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-1" style={{ scrollbarGutter: 'stable' }}>
        {transferQueue.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            전송 이력이 없습니다
          </div>
        ) : (
          <div className="space-y-1">
            {transferQueue.map((job) => (
              <TransferJobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function TransferJobRow({ job }: { job: TransferJob }) {
  const dirLabel = job.direction === 'PC_TO_CNC' ? 'PC→CNC' : 'CNC→PC';
  const dirColor = job.direction === 'PC_TO_CNC' ? 'text-blue-400' : 'text-green-400';

  const statusStyles: Record<TransferJob['status'], string> = {
    PENDING: 'text-gray-500',
    TRANSFERRING: 'text-blue-400',
    DONE: 'text-green-400',
    ERROR: 'text-red-400',
  };

  const statusLabels: Record<TransferJob['status'], string> = {
    PENDING: '대기',
    TRANSFERRING: '전송 중',
    DONE: '완료',
    ERROR: '오류',
  };

  return (
    <div className="flex items-center gap-2 text-xs h-6">
      {/* 시각 */}
      <span className="text-gray-600 w-14 flex-shrink-0 font-mono">
        {formatTime(job.startedAt)}
      </span>
      {/* 작업자 */}
      <span className="text-gray-500 w-12 flex-shrink-0 truncate">
        {job.userName}
      </span>
      {/* 방향 */}
      <span className={`w-14 flex-shrink-0 font-medium ${dirColor}`}>
        {dirLabel}
      </span>
      {/* 파일명 */}
      <span className="font-mono text-white w-20 truncate flex-shrink-0">
        {job.fileName}
      </span>
      {/* 진행바 */}
      <div className="flex-1 bg-gray-700 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            job.status === 'ERROR' ? 'bg-red-500' :
            job.status === 'DONE' ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${job.progress}%` }}
        />
      </div>
      {/* 상태 */}
      <span className={`w-10 text-right flex-shrink-0 ${statusStyles[job.status]}`}>
        {job.status === 'TRANSFERRING' ? `${job.progress}%` : statusLabels[job.status]}
      </span>
    </div>
  );
}

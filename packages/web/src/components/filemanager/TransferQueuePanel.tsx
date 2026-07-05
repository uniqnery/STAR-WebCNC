import { useEffect } from 'react';
import { useFileStore } from '../../stores/fileStore';
import type { FileOperationHistoryItem, TransferJob } from '../../stores/fileStore';


interface TransferQueuePanelProps {
  machineId: string;
}

export function TransferQueuePanel({ machineId }: TransferQueuePanelProps) {
  const transferQueue = useFileStore((s) => s.transferQueue);
  const fileHistory = useFileStore((s) => s.fileHistory);
  const fileHistoryLoading = useFileStore((s) => s.fileHistoryLoading);
  const loadFileHistory = useFileStore((s) => s.loadFileHistory);

  const activeTransfers = transferQueue.filter((job) => job.status === 'PENDING' || job.status === 'TRANSFERRING' || job.status === 'DONE');

  useEffect(() => {
    if (machineId) void loadFileHistory(machineId);
  }, [machineId, loadFileHistory]);

  return (
    <div className="bg-gray-800 rounded-lg shadow flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-300">
          파일 작업 이력 ({fileHistory.length})
        </span>
        {fileHistoryLoading && <span className="text-[11px] text-gray-500">조회 중</span>}
      </div>

      {activeTransfers.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0 space-y-1.5">
          {activeTransfers.slice(0, 3).map((job) => (
            <TransferProgressRow key={job.id} job={job} />
          ))}
          {activeTransfers.length > 3 && (
            <div className="text-[11px] text-gray-500">외 {activeTransfers.length - 3}건 진행 중</div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-1" style={{ scrollbarGutter: 'stable' }}>
        {fileHistory.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            파일 작업 이력이 없습니다
          </div>
        ) : (
          <div className="space-y-1">
            {fileHistory.map((item) => (
              <FileHistoryRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TransferProgressRow({ job }: { job: TransferJob }) {
  const label = job.direction === 'PC_TO_CNC' ? 'PC -> CNC' : 'CNC -> PC';
  const progress = Math.max(0, Math.min(100, job.progress));

  return (
    <div className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2 text-[11px]">
      <span className="font-medium text-blue-300">{label}</span>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="font-mono text-gray-200 truncate" title={job.fileName}>{job.fileName}</span>
          <span className="text-gray-500 flex-shrink-0">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <span className="text-right text-blue-300">진행 중</span>
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

function getOperationLabel(type: string): { label: string; color: string } {
  switch (type) {
    case 'UPLOAD_SHARE':
      return { label: 'PC 업로드', color: 'text-sky-400' };
    case 'DELETE_SHARE':
      return { label: 'PC 삭제', color: 'text-red-400' };
    case 'EDIT_SHARE':
      return { label: 'PC 저장', color: 'text-amber-300' };
    case 'TRANSFER_PC_TO_CNC':
      return { label: 'PC→CNC', color: 'text-blue-400' };
    case 'TRANSFER_CNC_TO_PC':
      return { label: 'CNC→PC', color: 'text-green-400' };
    case 'DELETE_REPO':
      return { label: 'DNC 삭제', color: 'text-red-400' };
    case 'EDIT_REPO':
      return { label: 'DNC 저장', color: 'text-amber-300' };
    default:
      return { label: type, color: 'text-gray-400' };
  }
}

function FileHistoryRow({ item }: { item: FileOperationHistoryItem }) {
  const op = getOperationLabel(item.operationType);
  const statusStyles: Record<string, string> = {
    PENDING: 'text-blue-400',
    SUCCESS: 'text-green-400',
    FAILURE: 'text-red-400',
  };
  const statusLabels: Record<string, string> = {
    PENDING: '진행 중',
    SUCCESS: '완료',
    FAILURE: '실패',
  };
  const status = item.status || 'PENDING';

  return (
    <div className="flex items-center gap-2 text-xs h-6">
      <span className="text-gray-600 w-14 flex-shrink-0 font-mono">
        {formatTime(item.startedAt)}
      </span>
      <span className="text-gray-500 w-16 flex-shrink-0 truncate">
        {item.userName || 'unknown'}
      </span>
      <span className={`w-16 flex-shrink-0 font-medium ${op.color}`}>
        {op.label}
      </span>
      <span className="font-mono text-white min-w-0 flex-1 truncate" title={item.fileName}>
        {item.fileName}
      </span>
      <span className={`w-12 text-right flex-shrink-0 ${statusStyles[status] ?? 'text-gray-400'}`} title={item.errorMessage ?? undefined}>
        {statusLabels[status] ?? status}
      </span>
    </div>
  );
}
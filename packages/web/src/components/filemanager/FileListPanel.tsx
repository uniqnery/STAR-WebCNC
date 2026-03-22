// FileListPanel - 재사용 가능한 파일 목록 패널 (다크 테마)
// Scheduler 저장소, Transfer 좌/우 패널에서 공용 사용

import type { ReactNode } from 'react';
import { useRef } from 'react';
import type { FileEntry } from '../../stores/fileStore';

// 파일 행 높이(px)
const ROW_HEIGHT_PX = 30;

interface FileListPanelProps {
  title: string;
  files: FileEntry[];
  isLoading: boolean;
  readOnly?: boolean;
  selectable?: boolean;
  selectedFiles?: string[];
  onSelectFiles?: (names: string[]) => void;
  onRefresh: () => void;
  onDoubleClick?: (file: FileEntry) => void;
  onDelete?: (names: string[]) => void;
  onUpload?: (file: File) => void;
  lockMessage?: string;
  emptyMessage?: string;
  pathComment?: string;
  headerSlot?: ReactNode;
  className?: string;
  /** CNC 모드: 크기/수정일 대신 코멘트 컬럼 표시 */
  showComment?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${min}`;
}

export function FileListPanel({
  title,
  files,
  isLoading,
  readOnly,
  selectable,
  selectedFiles = [],
  onSelectFiles,
  onRefresh,
  onDoubleClick,
  onDelete,
  onUpload,
  lockMessage,
  emptyMessage,
  pathComment,
  headerSlot,
  className,
  showComment = false,
}: FileListPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const allSelected = sorted.length > 0 && selectedFiles.length === sorted.length;

  const handleSelectAll = (checked: boolean) => {
    onSelectFiles?.(checked ? sorted.map((f) => f.name) : []);
  };

  const handleToggle = (name: string, checked: boolean) => {
    if (checked) {
      onSelectFiles?.([...selectedFiles, name]);
    } else {
      onSelectFiles?.(selectedFiles.filter((n) => n !== name));
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload?.(file);
      e.target.value = '';
    }
  };

  return (
    <div className={`flex flex-col bg-gray-900 rounded-lg shadow overflow-hidden ${className || ''}`}>
      {/* 헤더 - 고정 높이 h-10 */}
      <div className="flex items-center justify-between px-3 h-10 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-white whitespace-nowrap">{title}</span>
          {headerSlot}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={onRefresh}
            className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors"
            title="새로고침"
          >
            <RefreshIcon />
          </button>
          {onUpload && !readOnly && (
            <>
              <button
                onClick={handleUploadClick}
                className="p-1.5 text-gray-400 hover:text-green-400 hover:bg-gray-700 rounded transition-colors"
                title="업로드"
              >
                <UploadIcon />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".nc,.txt,.prg,.cnc"
                onChange={handleFileChange}
                className="hidden"
              />
            </>
          )}
          {onDelete && !readOnly && selectedFiles.length > 0 && (
            <button
              onClick={() => onDelete(selectedFiles)}
              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
              title="삭제"
            >
              <DeleteIcon />
            </button>
          )}
        </div>
      </div>

      {/* 경로 코멘트 */}
      {pathComment && (
        <div className="px-3 py-1.5 text-xs font-mono text-gray-500 bg-gray-850 border-b border-gray-700 truncate flex-shrink-0">
          {pathComment}
        </div>
      )}

      {/* 잠금 메시지 */}
      {lockMessage && (
        <div className="px-3 py-1.5 text-xs text-yellow-400 bg-yellow-900/20 border-b border-yellow-800 flex-shrink-0">
          {lockMessage}
        </div>
      )}

      {/* 테이블 헤더 */}
      <div className={`grid ${
        showComment
          ? selectable ? 'grid-cols-[32px_120px_1fr]' : 'grid-cols-[120px_1fr]'
          : selectable ? 'grid-cols-[32px_1fr_64px_80px]' : 'grid-cols-[1fr_64px_80px]'
      } px-3 py-1.5 bg-gray-800 text-xs font-medium text-gray-400 border-b border-gray-700 flex-shrink-0`}>
        {selectable && (
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => handleSelectAll(e.target.checked)}
              className="w-3.5 h-3.5"
            />
          </div>
        )}
        <div>프로그램 번호</div>
        {showComment
          ? <div className="text-gray-500">코멘트</div>
          : <>
              <div className="text-right">크기</div>
              <div className="text-right">수정일</div>
            </>
        }
      </div>

      {/* 파일 목록 - 남은 공간 전체 사용 + 스크롤 */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        style={{ scrollbarGutter: 'stable' }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            로딩 중...
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-1">
            <div className="text-gray-500 text-sm">파일 없음</div>
            {emptyMessage && (
              <div className="text-gray-600 text-xs text-center px-4">{emptyMessage}</div>
            )}
          </div>
        ) : (
          sorted.map((file) => {
            const isSelected = selectedFiles.includes(file.name);
            return (
              <div
                key={file.name}
                className={`grid ${
                  showComment
                    ? selectable ? 'grid-cols-[32px_120px_1fr]' : 'grid-cols-[120px_1fr]'
                    : selectable ? 'grid-cols-[32px_1fr_64px_80px]' : 'grid-cols-[1fr_64px_80px]'
                } px-3 text-sm border-b border-gray-800 cursor-pointer hover:bg-gray-700/50 transition-colors items-center ${
                  isSelected ? 'bg-blue-900/30' : ''
                }`}
                style={{ height: ROW_HEIGHT_PX }}
                onDoubleClick={() => onDoubleClick?.(file)}
              >
                {selectable && (
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => handleToggle(file.name, e.target.checked)}
                      className="w-3.5 h-3.5"
                    />
                  </div>
                )}
                <div className="font-mono text-white truncate flex items-center gap-1.5">
                  <FileIcon />
                  {file.name}
                </div>
                {showComment
                  ? <div className="text-gray-400 text-xs truncate italic">
                      {file.comment ? `(${file.comment})` : ''}
                    </div>
                  : <>
                      <div className="text-right text-gray-400">
                        {formatFileSize(file.size)}
                      </div>
                      <div className="text-right text-gray-400 text-xs">
                        {formatDate(file.modifiedAt)}
                      </div>
                    </>
                }
              </div>
            );
          })
        )}
      </div>

      {/* 하단 상태바 */}
      <div className="px-3 py-1 text-xs text-gray-500 border-t border-gray-700 bg-gray-800 flex-shrink-0">
        {sorted.length}개 파일{selectedFiles.length > 0 && ` (${selectedFiles.length}개 선택)`}
      </div>
    </div>
  );
}

// ── 아이콘 ──
function RefreshIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

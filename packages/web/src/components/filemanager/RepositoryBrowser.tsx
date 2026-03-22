// RepositoryBrowser - 스케줄러 DNC 프로그램 저장소 접이식 패널

import { useState, useEffect, useCallback } from 'react';
import { useFileStore, useRepoFiles } from '../../stores/fileStore';
import { useAuthStore } from '../../stores/authStore';
import { FileListPanel } from './FileListPanel';
import { MOCK_GCODE_CONTENT } from './mockFileData';
import type { FileEntry } from '../../stores/fileStore';

interface RepositoryBrowserProps {
  machineId: string;
  pathCount: number;
  isDncRunning: boolean;
  expanded: boolean;
  onToggle: () => void;
}

export function RepositoryBrowser({
  machineId,
  pathCount,
  isDncRunning,
  expanded,
  onToggle,
}: RepositoryBrowserProps) {
  const [activePath, setActivePath] = useState<'path1' | 'path2' | 'path3'>('path1');
  const files = useRepoFiles(machineId, activePath);
  const repoLoading = useFileStore((s) => s.repoLoading);
  const loadRepoFiles = useFileStore((s) => s.loadRepoFiles);
  const uploadToRepo = useFileStore((s) => s.uploadToRepo);
  const deleteFromRepo = useFileStore((s) => s.deleteFromRepo);
  const openViewer = useFileStore((s) => s.openViewer);
  const user = useAuthStore((s) => s.user);
  const canEdit = (user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER') && !isDncRunning;

  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  // 파일 로드
  useEffect(() => {
    if (machineId && expanded) {
      loadRepoFiles(machineId, activePath);
    }
  }, [machineId, activePath, expanded, loadRepoFiles]);

  // Path 전환 시 선택 초기화
  useEffect(() => {
    setSelectedFiles([]);
  }, [activePath]);

  const handleRefresh = useCallback(() => {
    loadRepoFiles(machineId, activePath);
    setSelectedFiles([]);
  }, [machineId, activePath, loadRepoFiles]);

  const handleUpload = useCallback((file: File) => {
    uploadToRepo(machineId, activePath, file.name, file.size);
  }, [machineId, activePath, uploadToRepo]);

  const handleDelete = useCallback((fileNames: string[]) => {
    if (!confirm(`${fileNames.length}개 파일을 삭제하시겠습니까?`)) return;
    deleteFromRepo(machineId, activePath, fileNames);
    setSelectedFiles([]);
  }, [machineId, activePath, deleteFromRepo]);

  const handleDoubleClick = useCallback((file: FileEntry) => {
    const content = MOCK_GCODE_CONTENT[file.name] || '';
    openViewer(file.name, content, !canEdit, 'SCHEDULER_REPO', machineId);
  }, [canEdit, openViewer, machineId]);

  const pathTabs: { key: 'path1' | 'path2' | 'path3'; label: string }[] = [
    { key: 'path1', label: 'PATH1' },
    { key: 'path2', label: 'PATH2' },
  ];
  if (pathCount >= 3) {
    pathTabs.push({ key: 'path3', label: 'PATH3' });
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
      {/* 접이식 헤더 */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            프로그램 저장소
          </span>
          {!expanded && (
            <span className="text-xs text-gray-400">
              {files.length}개 파일
            </span>
          )}
        </div>
        <span className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {/* 본문 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {/* Path 토글 */}
          <div className="flex items-center gap-1">
            {pathTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActivePath(tab.key)}
                className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${
                  activePath === tab.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 파일 목록 */}
          <FileListPanel
            title={`${machineId} / ${activePath.toUpperCase()}`}
            files={files}
            isLoading={repoLoading}
            readOnly={!canEdit}
            selectable={canEdit}
            selectedFiles={selectedFiles}
            onSelectFiles={setSelectedFiles}
            onRefresh={handleRefresh}
            onDoubleClick={handleDoubleClick}
            onDelete={canEdit ? handleDelete : undefined}
            onUpload={canEdit ? handleUpload : undefined}
            lockMessage={isDncRunning ? 'DNC 실행 중 - 저장소 읽기 전용' : undefined}
            className="max-h-[300px]"
          />
        </div>
      )}
    </div>
  );
}

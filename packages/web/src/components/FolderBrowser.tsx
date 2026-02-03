// FolderBrowser - 폴더 탐색 모달 컴포넌트

import { useState, useEffect, useCallback } from 'react';
import { dncApi } from '../lib/api';

interface FolderEntry {
  name: string;
  path: string;
}

interface FolderBrowserProps {
  isOpen: boolean;
  currentPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

// Mock 폴더 트리 (API 미연결 시 fallback)
const MOCK_FOLDER_TREE: Record<string, FolderEntry[]> = {
  '/': [
    { name: 'server', path: '/server' },
  ],
  '/server': [
    { name: 'programs', path: '/server/programs' },
    { name: 'backup', path: '/server/backup' },
  ],
  '/server/programs': [
    { name: 'MC-001', path: '/server/programs/MC-001' },
    { name: 'MC-002', path: '/server/programs/MC-002' },
    { name: 'MC-003', path: '/server/programs/MC-003' },
    { name: 'MC-004', path: '/server/programs/MC-004' },
    { name: 'shared', path: '/server/programs/shared' },
  ],
  '/server/programs/MC-001': [
    { name: 'Path1', path: '/server/programs/MC-001/Path1' },
    { name: 'Path2', path: '/server/programs/MC-001/Path2' },
  ],
  '/server/programs/MC-002': [
    { name: 'Path1', path: '/server/programs/MC-002/Path1' },
    { name: 'Path2', path: '/server/programs/MC-002/Path2' },
  ],
  '/server/programs/MC-003': [
    { name: 'Path1', path: '/server/programs/MC-003/Path1' },
    { name: 'Path2', path: '/server/programs/MC-003/Path2' },
  ],
  '/server/programs/MC-004': [
    { name: 'Path1', path: '/server/programs/MC-004/Path1' },
    { name: 'Path2', path: '/server/programs/MC-004/Path2' },
    { name: 'Path3', path: '/server/programs/MC-004/Path3' },
  ],
  '/server/programs/shared': [],
  '/server/backup': [],
  // Leaf nodes
  '/server/programs/MC-001/Path1': [],
  '/server/programs/MC-001/Path2': [],
  '/server/programs/MC-002/Path1': [],
  '/server/programs/MC-002/Path2': [],
  '/server/programs/MC-003/Path1': [],
  '/server/programs/MC-003/Path2': [],
  '/server/programs/MC-004/Path1': [],
  '/server/programs/MC-004/Path2': [],
  '/server/programs/MC-004/Path3': [],
};

function getParentPath(path: string): string | null {
  if (path === '/') return null;
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return '/';
  return '/' + segments.slice(0, -1).join('/');
}

export function FolderBrowser({ isOpen, currentPath, onSelect, onClose }: FolderBrowserProps) {
  const [browsePath, setBrowsePath] = useState(currentPath || '/server/programs');
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadFolders = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const response = await dncApi.listFolders(path);
      if (response.success && response.data) {
        const data = response.data as { folders: FolderEntry[] };
        setFolders(data.folders);
      } else {
        // Mock fallback
        setFolders(MOCK_FOLDER_TREE[path] || []);
      }
    } catch {
      // Mock fallback
      setFolders(MOCK_FOLDER_TREE[path] || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const startPath = currentPath || '/server/programs';
      setBrowsePath(startPath);
      loadFolders(startPath);
    }
  }, [isOpen, currentPath, loadFolders]);

  const navigateTo = (path: string) => {
    setBrowsePath(path);
    loadFolders(path);
  };

  const handleGoUp = () => {
    const parent = getParentPath(browsePath);
    if (parent) navigateTo(parent);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[480px] max-h-[520px] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            폴더 선택
          </h3>
        </div>

        {/* Current path */}
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-750 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <button
              onClick={handleGoUp}
              disabled={browsePath === '/'}
              className="px-2 py-1 text-sm bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ..
            </button>
            <span className="text-sm font-mono text-gray-600 dark:text-gray-300 truncate flex-1">
              {browsePath}
            </span>
          </div>
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-auto min-h-[200px] max-h-[320px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-gray-500">
              로딩 중...
            </div>
          ) : folders.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
              하위 폴더 없음 (현재 경로 선택 가능)
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {folders.map((folder) => (
                <button
                  key={folder.path}
                  onClick={() => navigateTo(folder.path)}
                  className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left transition-colors"
                >
                  <span className="text-yellow-500 text-lg">
                    {'\uD83D\uDCC1'}
                  </span>
                  <span className="text-sm text-gray-900 dark:text-white font-medium">
                    {folder.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-xs text-gray-500 truncate max-w-[260px]">
            선택: <span className="font-mono">{browsePath}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              취소
            </button>
            <button
              onClick={() => onSelect(browsePath)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              선택
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

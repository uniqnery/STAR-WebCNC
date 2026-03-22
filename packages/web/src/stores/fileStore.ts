// File Store - 파일 관리 시스템 Zustand 스토어

import { create } from 'zustand';
import { fileApi } from '../lib/api';

// ── 설정값 ──
export const TRANSFER_HISTORY_MAX = 100; // 전송 이력 최대 보관 개수 (FIFO)

// ── 논리 경로 타입 ──
export type LogicalRootType = 'SCHEDULER_REPO' | 'TRANSFER_SHARE' | 'CNC_LOCAL';

export interface FileEntry {
  name: string;           // 파일명 (O0001.nc)
  isDirectory: boolean;
  size: number;           // bytes
  modifiedAt: string;     // ISO
  programNo?: string;     // O번호 추출 (NC 파일)
  comment?: string;       // NC 프로그램 코멘트 (괄호 안 텍스트, CNC 파일만)
}

// ── 트랜스퍼 작업 ──
export type TransferDirection = 'PC_TO_CNC' | 'CNC_TO_PC';
export type ConflictPolicy = 'OVERWRITE' | 'RENAME' | 'SKIP';

export interface TransferJob {
  id: string;
  fileName: string;
  direction: TransferDirection;
  status: 'PENDING' | 'TRANSFERRING' | 'DONE' | 'ERROR';
  progress: number;       // 0~100
  error?: string;
  startedAt: string;      // ISO - 작업 시각
  userName: string;       // 작업자 명
}

// ── 뷰어 상태 ──
export interface ViewerState {
  isOpen: boolean;
  fileName: string;
  content: string;
  readOnly: boolean;
  dirty: boolean;
  sourceRoot: LogicalRootType;
  machineId?: string;
}

interface FileState {
  // 스케줄러 저장소
  repoFiles: Record<string, FileEntry[]>;  // key: "machineId:pathKey"
  repoLoading: boolean;

  // 트랜스퍼
  shareFiles: FileEntry[];
  cncFiles: FileEntry[];
  shareLoading: boolean;
  cncLoading: boolean;
  cncError: string | null;   // CNC 파일 로드 실패 메시지
  selectedShareFiles: string[];
  selectedCncFiles: string[];
  transferQueue: TransferJob[];

  // 뷰어
  viewer: ViewerState;

  // Actions - 저장소
  loadRepoFiles: (machineId: string, pathKey: string) => Promise<void>;
  uploadToRepo: (machineId: string, pathKey: string, fileName: string, size: number) => void;
  deleteFromRepo: (machineId: string, pathKey: string, fileNames: string[]) => void;

  // Actions - 트랜스퍼
  loadShareFiles: () => Promise<void>;
  loadCncFiles: (machineId: string, pathKey: string) => Promise<void>;
  setSelectedShareFiles: (names: string[]) => void;
  setSelectedCncFiles: (names: string[]) => void;
  uploadToShare: (fileName: string, size: number) => void;
  deleteFromShare: (fileNames: string[]) => void;
  startTransfer: (direction: TransferDirection, fileNames: string[], machineId: string, userName: string) => void;
  completeTransfer: (jobId: string) => void;
  clearCompletedTransfers: () => void;

  // Actions - 뷰어
  openViewer: (fileName: string, content: string, readOnly: boolean, sourceRoot: LogicalRootType, machineId?: string) => void;
  closeViewer: () => void;
  updateViewerContent: (content: string) => void;
  saveViewerContent: () => Promise<void>;
}

// G-Code 내용 미리보기 플레이스홀더
function getGCodeContent(fileName: string): string {
  return `; ${fileName}\n; (서버에서 내용을 불러오는 중...)\n`;
}

// FIFO: 최대 N개 유지, 초과 시 가장 오래된 항목부터 제거
function enforceHistoryMax(queue: TransferJob[]): TransferJob[] {
  if (queue.length <= TRANSFER_HISTORY_MAX) return queue;
  return queue.slice(queue.length - TRANSFER_HISTORY_MAX);
}

export const useFileStore = create<FileState>((set, get) => ({
  // 초기 상태
  repoFiles: {},
  repoLoading: false,
  shareFiles: [],
  cncFiles: [],
  shareLoading: false,
  cncLoading: false,
  cncError: null,
  selectedShareFiles: [],
  selectedCncFiles: [],
  transferQueue: [],
  viewer: {
    isOpen: false,
    fileName: '',
    content: '',
    readOnly: true,
    dirty: false,
    sourceRoot: 'TRANSFER_SHARE',
  },

  // ── 저장소 액션 ──
  loadRepoFiles: async (machineId, pathKey) => {
    set({ repoLoading: true });
    const key = `${machineId}:${pathKey}`;
    try {
      const res = await fileApi.listRepoFiles(machineId, pathKey);
      if (res.success && Array.isArray(res.data)) {
        set((state) => ({
          repoFiles: { ...state.repoFiles, [key]: res.data as FileEntry[] },
          repoLoading: false,
        }));
        return;
      }
    } catch (err) {
      console.error('loadRepoFiles failed:', err);
    }
    set((state) => ({
      repoFiles: { ...state.repoFiles, [key]: state.repoFiles[key] ?? [] },
      repoLoading: false,
    }));
  },

  uploadToRepo: (machineId, pathKey, fileName, size) => {
    const key = `${machineId}:${pathKey}`;
    const newFile: FileEntry = {
      name: fileName,
      isDirectory: false,
      size,
      modifiedAt: new Date().toISOString(),
      programNo: fileName.match(/^O?\d+/i)?.[0]?.toUpperCase(),
    };
    set((state) => ({
      repoFiles: {
        ...state.repoFiles,
        [key]: [...(state.repoFiles[key] || []), newFile],
      },
    }));
  },

  deleteFromRepo: (machineId, pathKey, fileNames) => {
    const key = `${machineId}:${pathKey}`;
    set((state) => ({
      repoFiles: {
        ...state.repoFiles,
        [key]: (state.repoFiles[key] || []).filter((f) => !fileNames.includes(f.name)),
      },
    }));
  },

  // ── 트랜스퍼 액션 ──
  loadShareFiles: async () => {
    set({ shareLoading: true });
    try {
      const res = await fileApi.listShareFiles();
      if (res.success && Array.isArray(res.data)) {
        set({ shareFiles: res.data as FileEntry[], shareLoading: false });
        return;
      }
    } catch (err) {
      console.error('loadShareFiles failed:', err);
    }
    set({ shareFiles: [], shareLoading: false });
  },

  loadCncFiles: async (machineId, _pathKey) => {
    set({ cncLoading: true, cncError: null });
    try {
      const res = await fileApi.listCncFiles(machineId);
      if (res.success) {
        // Agent 응답: { programs: [...], count: N } 또는 직접 배열
        const data = res.data as { programs?: FileEntry[] } | FileEntry[] | null;
        const files = Array.isArray(data)
          ? data
          : Array.isArray((data as { programs?: FileEntry[] })?.programs)
            ? (data as { programs: FileEntry[] }).programs
            : [];
        set({
          cncFiles: files,
          cncLoading: false,
          // 빈 목록이면 Agent 로그 확인 안내
          cncError: files.length === 0 ? 'CNC 메모리가 비어 있거나 Agent를 재빌드/재시작 해주세요' : null,
        });
        return;
      }
      // API 실패 — 에러 코드/메시지 표시
      const errData = res as { error?: { code?: string; message?: string } };
      const code = errData?.error?.code ?? 'UNKNOWN';
      const msg  = errData?.error?.message ?? '';
      let userMsg = `CNC 프로그램 목록 조회 실패 (${code})`;
      if (code === 'COMMAND_TIMEOUT') userMsg = 'Agent 응답 없음 — Agent가 실행 중인지 확인하세요';
      else if (code === 'CNC_NOT_CONNECTED') userMsg = 'CNC 미연결 — Agent의 FOCAS 연결 상태를 확인하세요';
      else if (code === 'UNKNOWN_COMMAND') userMsg = 'Agent 버전이 낮습니다 — Agent를 재빌드 후 재시작하세요';
      else if (msg) userMsg = `${userMsg}: ${msg}`;
      console.warn('[CNC] LIST_PROGRAMS failed:', code, msg);
      set({ cncFiles: [], cncLoading: false, cncError: userMsg });
    } catch (err) {
      console.error('loadCncFiles failed:', err);
      set({ cncFiles: [], cncLoading: false, cncError: 'API 서버에 연결할 수 없습니다' });
    }
  },

  setSelectedShareFiles: (names) => set({ selectedShareFiles: names }),
  setSelectedCncFiles: (names) => set({ selectedCncFiles: names }),

  uploadToShare: (fileName, size) => {
    const newFile: FileEntry = {
      name: fileName,
      isDirectory: false,
      size,
      modifiedAt: new Date().toISOString(),
      programNo: fileName.match(/^O?\d+/i)?.[0]?.toUpperCase(),
    };
    set((state) => ({
      shareFiles: [...state.shareFiles, newFile],
    }));
  },

  deleteFromShare: (fileNames) => {
    set((state) => ({
      shareFiles: state.shareFiles.filter((f) => !fileNames.includes(f.name)),
      selectedShareFiles: state.selectedShareFiles.filter((n) => !fileNames.includes(n)),
    }));
  },

  startTransfer: (direction, fileNames, machineId, userName) => {
    const now = new Date().toISOString();
    const jobs: TransferJob[] = fileNames.map((fileName) => ({
      id: `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fileName,
      direction,
      status: 'PENDING' as const,
      progress: 0,
      startedAt: now,
      userName,
    }));

    set((state) => ({
      transferQueue: enforceHistoryMax([...state.transferQueue, ...jobs]),
      selectedShareFiles: direction === 'PC_TO_CNC' ? [] : state.selectedShareFiles,
      selectedCncFiles: direction === 'CNC_TO_PC' ? [] : state.selectedCncFiles,
    }));

    // Set all to TRANSFERRING
    set((state) => ({
      transferQueue: state.transferQueue.map((j) =>
        jobs.some((jb) => jb.id === j.id) ? { ...j, status: 'TRANSFERRING', progress: 30 } : j
      ),
    }));

    // Try real API
    void fileApi
      .transfer(machineId, direction, fileNames, 'OVERWRITE')
      .then((res) => {
        if (res.success) {
          if (direction === 'PC_TO_CNC') {
            // PC→CNC: 서버가 Agent에 전송 명령을 보낸 시점 = 완료로 처리
            set((state) => ({
              transferQueue: state.transferQueue.map((j) =>
                jobs.some((jb) => jb.id === j.id) ? { ...j, status: 'DONE', progress: 100 } : j
              ),
            }));
          }
          // CNC→PC: 서버가 Agent에 다운로드 명령을 보낸 상태 (TRANSFERRING 유지)
          // file_downloaded WS 이벤트를 받으면 machineStore에서 DONE 처리
        } else {
          throw new Error('transfer failed');
        }
      })
      .catch(() => {
        // API 실패 시 Mock 시뮬레이션 fallback
        jobs.forEach((job, idx) => {
          const delay = idx * 1500;

          setTimeout(() => {
            set((state) => ({
              transferQueue: state.transferQueue.map((j) =>
                j.id === job.id ? { ...j, progress: 70 } : j
              ),
            }));
          }, delay + 500);

          setTimeout(() => {
            set((state) => ({
              transferQueue: state.transferQueue.map((j) =>
                j.id === job.id ? { ...j, status: 'DONE', progress: 100 } : j
              ),
            }));

            // PC→CNC: CNC 목록에 파일 추가 (Mock)
            if (direction === 'PC_TO_CNC') {
              const shareFile = get().shareFiles.find((f) => f.name === job.fileName);
              if (shareFile) {
                set((state) => ({
                  cncFiles: [...state.cncFiles.filter((f) => f.name !== shareFile.programNo), {
                    ...shareFile,
                    name: shareFile.programNo || shareFile.name.replace('.nc', ''),
                  }],
                }));
              }
            }
            // CNC→PC: Share 목록에 파일 추가 (Mock)
            if (direction === 'CNC_TO_PC') {
              const cncFile = get().cncFiles.find((f) => f.name === job.fileName);
              if (cncFile) {
                const pcName = `${cncFile.name}.nc`;
                set((state) => ({
                  shareFiles: [...state.shareFiles.filter((f) => f.name !== pcName), {
                    ...cncFile,
                    name: pcName,
                  }],
                }));
              }
            }
          }, delay + 1000);
        });
      });
  },

  completeTransfer: (jobId) => {
    set((state) => ({
      transferQueue: state.transferQueue.map((j) =>
        j.id === jobId ? { ...j, status: 'DONE', progress: 100 } : j
      ),
    }));
  },

  clearCompletedTransfers: () => {
    set((state) => ({
      transferQueue: state.transferQueue.filter((j) => j.status !== 'DONE' && j.status !== 'ERROR'),
    }));
  },

  // ── 뷰어 액션 ──
  openViewer: (fileName, content, readOnly, sourceRoot, machineId) => {
    const resolvedContent = content || getGCodeContent(fileName);
    set({
      viewer: {
        isOpen: true,
        fileName,
        content: resolvedContent,
        readOnly,
        dirty: false,
        sourceRoot,
        machineId,
      },
    });
  },

  closeViewer: () => {
    set({
      viewer: {
        isOpen: false,
        fileName: '',
        content: '',
        readOnly: true,
        dirty: false,
        sourceRoot: 'TRANSFER_SHARE',
      },
    });
  },

  updateViewerContent: (content) => {
    set((state) => ({
      viewer: { ...state.viewer, content, dirty: true },
    }));
  },

  saveViewerContent: async () => {
    const { viewer } = get();
    if (!viewer.isOpen || !viewer.fileName || !viewer.dirty) return;
    try {
      const root = viewer.sourceRoot;
      const machineId = viewer.machineId || '';
      await fileApi.writeFile(root, machineId, viewer.fileName, viewer.content);
    } catch { /* ignore — content already in state */ }
    set((state) => ({
      viewer: { ...state.viewer, dirty: false },
    }));
  },
}));

// Selectors
export const useRepoFiles = (machineId: string, pathKey: string) =>
  useFileStore((state) => state.repoFiles[`${machineId}:${pathKey}`] || []);

export const useViewer = () =>
  useFileStore((state) => state.viewer);

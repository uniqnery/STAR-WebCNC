// ProgramListModal — CNC 메모리 프로그램 리스트 + 선택
// LIST 버튼 클릭 시 오버레이로 표시
// 버튼바 좌측: [PATH1][PATH2] 계통 선택 / 우측: [열기][선택]

import { useState, useEffect, useCallback } from 'react';
import { commandApi } from '../../lib/api';

interface ProgramEntry {
  programNo: string;   // "O0001"
  comment:   string;
  size?:     number;
}

interface ProgramListModalProps {
  machineId:  string;
  activePath: 1 | 2;
  onClose:    () => void;
}

type ModalView = 'list' | 'content';

function FileIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

export function ProgramListModal({ machineId, activePath, onClose }: ProgramListModalProps) {
  const [selectedPath,    setSelectedPath]    = useState<1 | 2>(activePath);
  const [view,            setView]            = useState<ModalView>('list');
  const [programs,        setPrograms]        = useState<ProgramEntry[]>([]);
  const [highlighted,     setHighlighted]     = useState<string | null>(null);
  const [openedProgram,   setOpenedProgram]   = useState<string | null>(null);
  const [programContent,  setProgramContent]  = useState<string>('');
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [selecting,       setSelecting]       = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await commandApi.sendAndWait(machineId, 'LIST_PROGRAMS', { path: selectedPath }, 15_000);
      if (res.success) {
        const progs = (res.data?.result as { programs?: ProgramEntry[] })?.programs ?? [];
        setPrograms(progs);
      } else {
        setError(res.data?.errorMessage ?? '목록 조회 실패');
      }
    } catch {
      setError('목록 조회 중 오류 발생');
    } finally {
      setLoading(false);
    }
  }, [machineId, selectedPath]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  const handlePathChange = (path: 1 | 2) => {
    if (path === selectedPath) return;
    setSelectedPath(path);
    setView('list');
    setHighlighted(null);
    setOpenedProgram(null);
    setProgramContent('');
    setError(null);
  };

  const openProgram = async (programNo: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await commandApi.sendAndWait(machineId, 'DOWNLOAD_PROGRAM', {
        fileName: programNo,
        path: selectedPath,
      }, 20_000);
      if (res.success) {
        const content = (res.data?.result as { content?: string })?.content ?? '';
        setOpenedProgram(programNo);
        setProgramContent(content);
        setView('content');
      } else {
        setError(res.data?.errorMessage ?? '프로그램 읽기 실패');
      }
    } catch {
      setError('프로그램 읽기 중 오류 발생');
    } finally {
      setLoading(false);
    }
  };

  const selectProgram = async (programNo?: string) => {
    const target = programNo ?? (view === 'content' ? openedProgram : highlighted);
    if (!target) return;
    const oNo = parseInt(target.replace(/^O0*/, '') || '0', 10);
    if (oNo === 0) return;
    setSelecting(true);
    try {
      await commandApi.sendAndWait(machineId, 'SEARCH_PROGRAM', { programNo: oNo, path: selectedPath }, 10_000);
    } finally {
      setSelecting(false);
    }
    onClose();
  };

  const backToList = () => {
    setView('list');
    setOpenedProgram(null);
    setProgramContent('');
    setError(null);
  };

  const pathLabel = selectedPath === 1 ? 'PATH1 (MAIN)' : 'PATH2 (SUB)';
  const canOpen   = view === 'list' && highlighted !== null && !loading;
  const canSelect = !selecting && (
    (view === 'list' && highlighted !== null) ||
    (view === 'content' && openedProgram !== null)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col w-[800px] max-w-[90vw] h-[600px] max-h-[85vh]">

        {/* ── 헤더: PATH 표시 + X ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 shrink-0">
          <span className="text-cyan-300 text-sm font-semibold">{pathLabel}</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── 버튼바 ── */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0 bg-gray-800/50">
          {/* 좌측: Path 선택(list) 또는 뒤로(content) */}
          <div className="flex items-center gap-2">
            {view === 'list' ? (
              <div className="flex gap-1">
                {([1, 2] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePathChange(p)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                      selectedPath === p
                        ? 'bg-cyan-700 text-white'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    PATH{p}
                  </button>
                ))}
              </div>
            ) : (
              <button
                onClick={backToList}
                className="flex items-center gap-1 text-xs text-gray-300 hover:text-white px-2 py-1 rounded hover:bg-gray-700 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                뒤로
              </button>
            )}
          </div>
          {/* 우측: 열기 / 선택 */}
          <div className="flex gap-2">
            {view === 'list' && (
              <button
                disabled={!canOpen}
                onClick={() => highlighted && void openProgram(highlighted)}
                className="px-3 py-1 text-xs font-medium rounded bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                열기
              </button>
            )}
            <button
              disabled={!canSelect}
              onClick={() => void selectProgram()}
              className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {selecting ? '선택 중...' : '선택'}
            </button>
          </div>
        </div>

        {/* ── 본문 ── */}
        <div className="flex-1 min-h-0 overflow-hidden">

          {/* 로딩 */}
          {loading && (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              조회 중...
            </div>
          )}

          {/* 에러 */}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-red-400 text-sm px-4">
              <span>{error}</span>
              <button onClick={() => void fetchList()} className="text-xs px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">
                재시도
              </button>
            </div>
          )}

          {/* 리스트 뷰 */}
          {!loading && !error && view === 'list' && (
            <div className="overflow-y-auto h-full font-mono text-xs">
              {programs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">프로그램 없음</div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-gray-800 border-b border-gray-700">
                    <tr>
                      <th className="text-left px-3 py-1.5 text-gray-400 font-medium w-20">프로그램</th>
                      <th className="text-left px-3 py-1.5 text-gray-400 font-medium">코멘트</th>
                      <th className="text-right px-3 py-1.5 text-gray-400 font-medium w-24">크기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {programs.map((p) => (
                      <tr
                        key={p.programNo}
                        onClick={() => setHighlighted(p.programNo)}
                        onDoubleClick={() => void openProgram(p.programNo)}
                        style={{ height: '30px' }}
                        className={`cursor-pointer border-b border-gray-800 hover:bg-gray-700/50 transition-colors ${
                          highlighted === p.programNo ? 'bg-blue-900/40 border-blue-700/50' : ''
                        }`}
                      >
                        <td className="px-3">
                          <div className="flex items-center gap-1.5 font-mono font-semibold text-white">
                            <FileIcon />
                            {p.programNo}
                          </div>
                        </td>
                        <td className="px-3 text-gray-300">{p.comment || <span className="text-gray-600">—</span>}</td>
                        <td className="px-3 text-gray-500 text-right tabular-nums">
                          {p.size ? `${p.size}B` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 프로그램 내용 뷰 (읽기 전용) */}
          {!loading && !error && view === 'content' && (
            <div className="h-full overflow-y-auto bg-gray-950 p-4">
              <div className="text-cyan-400 text-xs font-semibold mb-2 font-mono">{openedProgram}</div>
              <pre className="text-green-400 font-mono text-xs leading-5 whitespace-pre-wrap select-text">
                {programContent}
              </pre>
            </div>
          )}
        </div>

        {/* 하단 상태바 — 콘텐츠 뷰에서만 표시 */}
        {view === 'content' && !loading && !error && (
          <div className="flex items-center justify-between px-4 py-1.5 border-t border-gray-700 text-xs text-gray-500 shrink-0">
            <span>{programContent.split('\n').length} lines</span>
            <div className="flex items-center gap-3">
              <span className="text-yellow-500">읽기 전용</span>
              <span>UTF-8</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

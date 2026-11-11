import { useCallback, useEffect, useRef, useState } from 'react';
import { fileApi, schedulerApi } from '../../lib/api';
import type { FileEntry } from '../../stores/fileStore';

interface UploadItem {
  id: string;
  file: File;
  sourceProgramNo: string;
  targetProgramNo: string;
  comment: string;
  conflict: boolean;
  conflictAction: 'replace' | 'skip';
  status: 'ready' | 'uploading' | 'done' | 'error';
  error?: string;
}

interface Props {
  machineId: string;
  open: boolean;
  canEdit: boolean;
  isTransferRunning: boolean;
  isTransferMode: boolean;
  defaultSubProgramNo?: string;
  defaultPreset?: number;
  onSchedulerRegistered?: () => void;
  onClose: () => void;
}

const normalizeNo = (value: string) => {
  const match = value.trim().match(/^O?(\d{1,4})$/i);
  if (!match) return '';
  const number = Number(match[1]);
  return number >= 1 && number <= 9999 ? `O${String(number).padStart(4, '0')}` : '';
};
const fileNameNo = (name: string) => normalizeNo(name.replace(/\.(nc|txt)$/i, ''));
const contentNo = (content: string) => normalizeNo(content.match(/^\s*O(\d{1,4})\b/im)?.[1] ?? '');
const contentComment = (content: string) => content.match(/^\s*O\d{1,4}\b[ \t]*\(([^)\r\n]*)\)/im)?.[1]?.trim() ?? '';
const formatBytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

export function ProgramRepositoryModal({ machineId, open, canEdit, isTransferRunning, isTransferMode, defaultSubProgramNo, defaultPreset, onSchedulerRegistered, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [programs, setPrograms] = useState<FileEntry[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [selectedProgramNos, setSelectedProgramNos] = useState<string[]>([]);
  const [registrationMode, setRegistrationMode] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [repositoryPath, setRepositoryPath] = useState(`{PROGRAM_REPOSITORY_ROOT}\\${machineId}\\path1`);

  const loadPrograms = useCallback(async () => {
    const response = await fileApi.listRepoFiles(machineId, 'path1');
    if (response.success && Array.isArray(response.data)) setPrograms(response.data as FileEntry[]);
  }, [machineId]);

  useEffect(() => {
    if (!open) return;
    setSelectedProgramNos([]);
    setRegistrationMode(false);
    setActionError('');
    void loadPrograms();
  }, [open, loadPrograms]);

  useEffect(() => {
    if (!open) return;
    void fileApi.getRepoPath1Info(machineId).then((response) => {
      const data = response.data as { path?: string } | undefined;
      if (response.success && data?.path) setRepositoryPath(data.path);
    });
  }, [open, machineId]);

  const addFiles = useCallback(async (files: File[]) => {
    const existingNos = new Set(programs.map((program) => normalizeNo(program.programNo ?? program.name.replace(/\.nc$/i, ''))));
    const accepted: UploadItem[] = [];
    for (const file of files) {
      if (!/^O?\d{1,4}(?:\.(?:nc|txt))?$/i.test(file.name)) {
        accepted.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, sourceProgramNo: '', targetProgramNo: '', comment: '', conflict: false, conflictAction: 'skip', status: 'error', error: '허용 파일명: O0001, O0001.nc, O0001.txt' });
        continue;
      }
      const content = await file.text();
      const sourceProgramNo = contentNo(content);
      const targetProgramNo = sourceProgramNo || fileNameNo(file.name);
      const conflict = existingNos.has(targetProgramNo);
      accepted.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, sourceProgramNo, targetProgramNo, comment: contentComment(content), conflict, conflictAction: 'skip', status: sourceProgramNo && targetProgramNo ? 'ready' : 'error', error: sourceProgramNo && targetProgramNo ? undefined : '파일 내부 O번호를 확인할 수 없습니다.' });
      if (targetProgramNo) existingNos.add(targetProgramNo);
    }
    setItems((current) => [...current, ...accepted]);
  }, [programs]);

  useEffect(() => {
    if (!open) return;
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [open, addFiles]);

  const updateItem = (id: string, update: Partial<UploadItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  const updateTarget = (item: UploadItem, value: string) => {
    const targetProgramNo = normalizeNo(value);
    const conflict = programs.some((program) => normalizeNo(program.programNo ?? program.name.replace(/\.nc$/i, '')) === targetProgramNo);
    const valid = Boolean(targetProgramNo && item.sourceProgramNo);
    updateItem(item.id, { targetProgramNo, conflict, conflictAction: conflict ? 'skip' : 'replace', status: valid ? 'ready' : 'error', error: valid ? undefined : '유효한 O번호를 입력하세요.' });
  };

  const updateProgramComment = async (program: FileEntry, comment: string) => {
    const programNo = program.programNo ?? program.name.replace(/\.nc$/i, '');
    if ((program.comment ?? '') === comment) return;
    const response = await fileApi.updateRepoComment(machineId, programNo, comment);
    if (!response.success) setActionError(response.error?.message ?? '코멘트 수정 실패');
    await loadPrograms();
  };

  const uploadAll = async () => {
    setLoading(true);
    setActionError('');
    for (const item of items) {
      if (item.status !== 'ready' || (item.conflict && item.conflictAction === 'skip')) continue;
      updateItem(item.id, { status: 'uploading', error: undefined });
      try {
        const response = await fileApi.uploadRepoFile(machineId, item.file, { targetProgramNo: item.targetProgramNo, comment: item.comment, overwrite: item.conflict && item.conflictAction === 'replace' });
        updateItem(item.id, response.success ? { status: 'done' } : { status: 'error', error: response.error?.message ?? '업로드 실패' });
      } catch (error) {
        updateItem(item.id, { status: 'error', error: error instanceof Error ? error.message : '업로드 실패' });
      }
    }
    await loadPrograms();
    setLoading(false);
  };

  const toggleSelection = (programNo: string) => setSelectedProgramNos((current) => current.includes(programNo) ? current.filter((selected) => selected !== programNo) : [...current, programNo]);
  const toggleAll = () => {
    const all = programs.map((program) => program.programNo ?? program.name.replace(/\.nc$/i, ''));
    setSelectedProgramNos((current) => current.length === all.length ? [] : all);
  };

  const deleteSelected = async () => {
    const selectedFiles = programs.filter((program) => selectedProgramNos.includes(program.programNo ?? program.name.replace(/\.nc$/i, ''))).map((program) => program.name);
    const response = await fileApi.deleteFiles('SCHEDULER_REPO', machineId, selectedFiles, 'path1');
    setDeleteConfirmOpen(false);
    if (!response.success) { setActionError(response.error?.message ?? '삭제 실패'); return; }
    setSelectedProgramNos([]);
    await loadPrograms();
  };

  const registerSelected = async () => {
    setLoading(true);
    setActionError('');
    const response = await schedulerApi.batchRegister({ machineId, programNos: selectedProgramNos, ...(defaultSubProgramNo ? { subProgramNo: defaultSubProgramNo } : {}), preset: defaultPreset ?? 10 });
    setLoading(false);
    if (!response.success) { setActionError(response.error?.message ?? '스케줄러 등록 실패'); return; }
    setSelectedProgramNos([]);
    setRegistrationMode(false);
    await loadPrograms();
    onSchedulerRegistered?.();
  };

  if (!open) return null;
  const disabled = !canEdit;
  const selectedPrograms = programs.filter((program) => selectedProgramNos.includes(program.programNo ?? program.name.replace(/\.nc$/i, '')));
  const deleteBlocked = selectedPrograms.some((program) => program.schedulerRegistered || program.isRunning);

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
    <div className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-800">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700"><div><h2 className="font-semibold text-gray-900 dark:text-white">프로그램 저장소</h2><div className="mt-1 font-mono text-xs text-gray-500">{repositoryPath}</div></div><button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-700 dark:hover:text-white">×</button></div>
      {actionError && <div className="mx-5 mt-3 rounded bg-red-900/20 px-3 py-2 text-sm text-red-500">{actionError}</div>}
      {isTransferRunning && <div className="mx-5 mt-3 rounded bg-blue-900/20 px-3 py-2 text-sm text-blue-400">운전 중에도 신규 업로드와 대기 행 등록이 가능합니다. 현재 실행 프로그램은 변경할 수 없습니다.</div>}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)] gap-4 overflow-hidden p-5">
        <div className="flex min-h-0 flex-col gap-4">
          <section className="shrink-0 rounded-lg border border-gray-200 p-4 dark:border-gray-700"><h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">파일 추가</h3><div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }} className={`rounded-lg border-2 border-dashed p-6 text-center ${dragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600'}`}><div className="text-sm text-gray-600 dark:text-gray-300">Windows 탐색기에서 파일을 끌어놓거나 복사 후 Ctrl+V</div><button disabled={disabled} onClick={() => inputRef.current?.click()} className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40">파일 선택</button><input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} /><div className="mt-2 text-xs text-gray-400">O0001, O0001.nc, O0001.txt · 복수 선택 가능</div></div></section>
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700"><h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">업로드 대기</h3><button onClick={() => setItems((current) => current.map((item) => item.conflict ? { ...item, conflictAction: 'replace' } : item))} className="text-xs text-blue-500">충돌 모두 교체</button></div>
            <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">{items.map((item) => <div key={item.id} className="rounded bg-gray-50 p-2 text-xs dark:bg-gray-700/60"><div className="mb-2 flex items-center justify-between gap-2"><span className="truncate font-mono" title={item.file.name}>{item.file.name}</span><button onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} className="text-red-400">×</button></div><div className="grid grid-cols-[7rem_minmax(0,1fr)_7rem] gap-2"><input value={item.targetProgramNo} onChange={(event) => updateItem(item.id, { targetProgramNo: event.target.value })} onBlur={(event) => updateTarget(item, event.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1 font-mono dark:border-gray-600 dark:bg-gray-800" /><input value={item.comment} maxLength={500} onChange={(event) => updateItem(item.id, { comment: event.target.value })} placeholder="파일에서 추출한 코멘트" className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800" />{item.conflict ? <select value={item.conflictAction} onChange={(event) => updateItem(item.id, { conflictAction: event.target.value as 'replace' | 'skip' })} className="rounded bg-white px-1 py-1 dark:bg-gray-800"><option value="skip">건너뛰기</option><option value="replace">교체</option></select> : <span className={item.status === 'done' ? 'text-green-500' : item.status === 'error' ? 'text-red-500' : 'text-gray-400'}>{item.status === 'done' ? '완료' : item.status === 'uploading' ? '업로드 중' : item.status === 'error' ? item.error : '신규'}</span>}</div>{item.sourceProgramNo && <div className="mt-1 text-[10px] text-gray-400">원본 {item.sourceProgramNo} · 저장 시 {item.targetProgramNo}{item.comment ? `(${item.comment})` : ''}</div>}</div>)}{items.length === 0 && <div className="py-8 text-center text-xs text-gray-400">추가한 파일이 없습니다.</div>}</div>
            <div className="border-t border-gray-200 p-3 text-right dark:border-gray-700"><button disabled={disabled || loading || items.every((item) => item.status !== 'ready')} onClick={uploadAll} className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40">{loading ? '처리 중...' : '파일 전송'}</button></div>
          </section>
        </div>
        <section className="flex min-h-0 flex-col rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700"><div><h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">프로그램 목록</h3><div className="text-[11px] text-gray-400">{programs.length}개 · {selectedProgramNos.length}개 선택{!isTransferMode ? ' · 파일전송 모드에서 스케줄러 등록 가능' : ''}</div></div><div className="flex gap-2">{!registrationMode && <button disabled={disabled || !isTransferMode} title={!isTransferMode ? '메인 운전 모드를 파일전송으로 변경하세요.' : ''} onClick={() => { setRegistrationMode(true); setSelectedProgramNos([]); }} className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-40">스케줄러 등록</button>}{!registrationMode && <button disabled={disabled || selectedProgramNos.length === 0 || deleteBlocked} onClick={() => setDeleteConfirmOpen(true)} title={deleteBlocked ? '스케줄러 등록 프로그램은 삭제할 수 없습니다.' : ''} className="rounded bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-40">선택 삭제</button>}</div></div>
          <div className="grid grid-cols-[3rem_7rem_minmax(10rem,1fr)_6rem] items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-900/30"><label className="flex items-center justify-center"><input type="checkbox" checked={programs.length > 0 && selectedProgramNos.length === programs.length} onChange={toggleAll} /></label><span>프로그램</span><span>코멘트</span><span className="text-right">용량</span></div>
          <div className="min-h-0 flex-1 overflow-auto">{programs.map((program) => { const programNo = program.programNo ?? program.name.replace(/\.nc$/i, ''); const selectionOrder = selectedProgramNos.indexOf(programNo) + 1; return <div key={program.name} className={`grid grid-cols-[3rem_7rem_minmax(10rem,1fr)_6rem] items-center gap-2 border-b border-gray-100 px-3 py-2 text-xs dark:border-gray-700 ${program.schedulerMismatch ? 'bg-orange-900/15' : ''}`}><label className="relative flex items-center justify-center"><input type="checkbox" checked={selectionOrder > 0} onChange={() => toggleSelection(programNo)} />{registrationMode && selectionOrder > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] text-white">{selectionOrder}</span>}</label><div className="min-w-0"><div className="truncate font-mono font-semibold" title={programNo}>{programNo}</div><div className="mt-0.5 flex flex-wrap gap-1">{program.isRunning && <span className="rounded bg-green-900/30 px-1 text-[9px] text-green-400">실행 중</span>}{program.schedulerRegistered && <span className="rounded bg-blue-900/30 px-1 text-[9px] text-blue-400">등록됨</span>}{program.schedulerMismatch && <span className="rounded bg-orange-900/30 px-1 text-[9px] text-orange-400">변경됨</span>}</div></div><input defaultValue={program.comment ?? ''} disabled={disabled || program.isRunning} maxLength={500} onBlur={(event) => { void updateProgramComment(program, event.target.value); }} placeholder="코멘트 없음" className="min-w-0 rounded border border-gray-200 bg-transparent px-2 py-1 text-gray-600 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300" /><span className="text-right font-mono text-gray-400">{formatBytes(program.size)}</span></div>; })}{programs.length === 0 && <div className="p-6 text-center text-xs text-gray-400">등록된 프로그램이 없습니다.</div>}</div>
          {registrationMode && <div className="flex items-center justify-between border-t border-gray-200 px-3 py-3 dark:border-gray-700"><span className="text-xs text-gray-500">체크한 순서대로 등록됩니다.</span><div className="flex gap-2"><button onClick={() => { setRegistrationMode(false); setSelectedProgramNos([]); }} className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600">취소</button><button disabled={loading || selectedProgramNos.length === 0} onClick={registerSelected} className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-40">확인 ({selectedProgramNos.length})</button></div></div>}
        </section>
      </div>
      <div className="flex justify-end border-t border-gray-200 px-5 py-3 dark:border-gray-700"><button onClick={onClose} className="rounded border border-gray-300 px-4 py-2 text-sm dark:border-gray-600">닫기</button></div>
    </div>
    {deleteConfirmOpen && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60"><div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800"><h3 className="font-semibold text-gray-900 dark:text-white">프로그램 삭제</h3><p className="mt-3 text-sm text-gray-600 dark:text-gray-300">선택한 {selectedProgramNos.length}개 프로그램을 삭제하시겠습니까?</p><div className="mt-2 max-h-32 overflow-auto rounded bg-gray-50 p-2 font-mono text-xs dark:bg-gray-900/40">{selectedProgramNos.join(', ')}</div><div className="mt-5 flex justify-end gap-2"><button onClick={() => setDeleteConfirmOpen(false)} className="rounded border border-gray-300 px-4 py-2 text-sm dark:border-gray-600">취소</button><button onClick={() => void deleteSelected()} className="rounded bg-red-600 px-4 py-2 text-sm text-white">삭제</button></div></div></div>}
  </div>;
}

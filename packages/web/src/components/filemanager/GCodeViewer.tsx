// GCodeViewer - G-Code 열람/편집 모달 (구문 강조)

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useAuthStore } from '../../stores/authStore';

export function GCodeViewer() {
  const viewer = useFileStore((s) => s.viewer);
  const closeViewer = useFileStore((s) => s.closeViewer);
  const updateViewerContent = useFileStore((s) => s.updateViewerContent);
  const saveViewerContent = useFileStore((s) => s.saveViewerContent);
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';

  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 편집 모드 시 textarea에 포커스
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  // 모달 닫힐 때 편집 모드 해제
  useEffect(() => {
    if (!viewer.isOpen) {
      setIsEditing(false);
    }
  }, [viewer.isOpen]);

  const handleSave = useCallback(() => {
    saveViewerContent();
    setIsEditing(false);
  }, [saveViewerContent]);

  const handleClose = useCallback(() => {
    if (viewer.dirty) {
      if (!confirm('저장하지 않은 변경사항이 있습니다. 닫으시겠습니까?')) return;
    }
    setIsEditing(false);
    closeViewer();
  }, [viewer.dirty, closeViewer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl+S: 저장
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (isEditing && viewer.dirty) handleSave();
    }
    // Escape: 닫기
    if (e.key === 'Escape') {
      handleClose();
    }
  }, [isEditing, viewer.dirty, handleSave, handleClose]);

  const lines = useMemo(() => viewer.content.split('\n'), [viewer.content]);
  const lineCount = lines.length;

  if (!viewer.isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-gray-900 rounded-lg shadow-2xl w-[800px] max-w-[90vw] h-[600px] max-h-[85vh] flex flex-col border border-gray-700">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono font-bold text-white">{viewer.fileName}</span>
            {viewer.dirty && (
              <span className="text-xs text-yellow-400 font-medium">* 수정됨</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!viewer.readOnly && canEdit && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                편집
              </button>
            )}
            {isEditing && viewer.dirty && (
              <button
                onClick={handleSave}
                className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                저장
              </button>
            )}
            {isEditing && (
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"
              >
                취소
              </button>
            )}
            <button
              onClick={handleClose}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 min-h-0 overflow-auto font-mono text-sm">
          {isEditing ? (
            <div className="flex h-full">
              {/* 줄 번호 (편집 모드) */}
              <EditLineNumbers lineCount={viewer.content.split('\n').length} />
              <textarea
                ref={textareaRef}
                value={viewer.content}
                onChange={(e) => updateViewerContent(e.target.value)}
                className="flex-1 bg-gray-900 text-green-400 p-2 resize-none outline-none font-mono text-sm leading-6 border-none"
                spellCheck={false}
              />
            </div>
          ) : (
            <HighlightedCode lines={lines} />
          )}
        </div>

        {/* 하단 상태바 */}
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-gray-700 text-xs text-gray-500">
          <span>{lineCount} lines</span>
          <div className="flex items-center gap-3">
            {isEditing && <span className="text-blue-400">편집 중</span>}
            {viewer.readOnly && <span className="text-yellow-500">읽기 전용</span>}
            <span>UTF-8</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 편집 모드 줄 번호 ──
function EditLineNumbers({ lineCount }: { lineCount: number }) {
  const nums = Array.from({ length: lineCount }, (_, i) => i + 1);
  return (
    <div className="bg-gray-800 text-gray-500 text-right px-2 py-2 select-none leading-6 border-r border-gray-700 min-w-[40px]">
      {nums.map((n) => (
        <div key={n}>{n}</div>
      ))}
    </div>
  );
}

// ── 구문 강조 코드 뷰 ──
function HighlightedCode({ lines }: { lines: string[] }) {
  return (
    <div className="p-0">
      {lines.map((line, i) => (
        <div key={i} className="flex leading-6 hover:bg-gray-800/50">
          {/* 줄 번호 */}
          <span className="w-10 text-right px-2 text-gray-600 select-none flex-shrink-0 bg-gray-800/30">
            {i + 1}
          </span>
          {/* 코드 */}
          <span className="px-2 whitespace-pre">
            <GCodeLine text={line} />
          </span>
        </div>
      ))}
    </div>
  );
}

// ── G-Code 라인 구문 강조 ──
function GCodeLine({ text }: { text: string }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={token.className}>
          {token.text}
        </span>
      ))}
    </>
  );
}

interface Token {
  text: string;
  className: string;
}

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    let matched = false;

    // 괄호 코멘트: (...)
    const parenComment = remaining.match(/^\([^)]*\)/);
    if (parenComment) {
      tokens.push({ text: parenComment[0], className: 'text-gray-500 italic' });
      remaining = remaining.slice(parenComment[0].length);
      matched = true;
      continue;
    }

    // 세미콜론 코멘트: ; 이후 전부
    if (remaining.startsWith(';')) {
      tokens.push({ text: remaining, className: 'text-gray-500 italic' });
      remaining = '';
      matched = true;
      continue;
    }

    // O번호: O0001 등
    const oNum = remaining.match(/^O\d+/i);
    if (oNum) {
      tokens.push({ text: oNum[0], className: 'text-cyan-400 font-bold' });
      remaining = remaining.slice(oNum[0].length);
      matched = true;
      continue;
    }

    // N번호: N10, N00020 등
    const nNum = remaining.match(/^N\d+/i);
    if (nNum) {
      tokens.push({ text: nNum[0], className: 'text-gray-500' });
      remaining = remaining.slice(nNum[0].length);
      matched = true;
      continue;
    }

    // G코드: G00, G01, G28, G96 등
    const gCode = remaining.match(/^G\d{1,3}(\.\d)?/i);
    if (gCode) {
      tokens.push({ text: gCode[0], className: 'text-green-400 font-bold' });
      remaining = remaining.slice(gCode[0].length);
      matched = true;
      continue;
    }

    // M코드: M03, M30, M750 등
    const mCode = remaining.match(/^M\d{1,4}/i);
    if (mCode) {
      tokens.push({ text: mCode[0], className: 'text-blue-400 font-bold' });
      remaining = remaining.slice(mCode[0].length);
      matched = true;
      continue;
    }

    // 축 + 값: X50.0, Z-40.0, F0.2, S3000, T0101 등
    const axis = remaining.match(/^[XYZCRFSTUHDBPQLIJK][+-]?\d+\.?\d*/i);
    if (axis) {
      tokens.push({ text: axis[0], className: 'text-yellow-300' });
      remaining = remaining.slice(axis[0].length);
      matched = true;
      continue;
    }

    // 그 외 한 글자
    if (!matched) {
      tokens.push({ text: remaining[0], className: 'text-green-400' });
      remaining = remaining.slice(1);
    }
  }

  return tokens;
}

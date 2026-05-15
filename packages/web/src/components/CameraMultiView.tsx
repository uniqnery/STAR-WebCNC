// CameraMultiView — 장비당 다중 카메라 그리드 + 확대 뷰
// 1대: CameraStream 직접 (기존 동작 유지)
// 2대: 좌우 2분할 (thumb 스트림)
// 3~4대: 2×2 그리드 (thumb 스트림)
// 셀 클릭 → 확대 모드 (풀화질 스트림, ◀▶ 네비게이션)
// Page Visibility API는 CameraStream 내부에서 처리

import { useState } from 'react';
import { CameraConfig } from '../stores/cameraStore';
import { CameraStream } from './CameraStream';

interface CameraMultiViewProps {
  cameras: CameraConfig[];
  className?: string;
}

export function CameraMultiView({ cameras, className = '' }: CameraMultiViewProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (cameras.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 text-gray-500 ${className}`}>
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.89L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          <p className="text-sm">카메라 미설정</p>
          <p className="text-xs mt-1 text-gray-600">설정에서 카메라를 등록하세요</p>
        </div>
      </div>
    );
  }

  if (cameras.length === 1) {
    return <CameraStream camera={cameras[0]} className={className} showControls />;
  }

  // 확대 모드
  if (expandedIndex !== null) {
    const cam = cameras[expandedIndex];
    const prev = (expandedIndex - 1 + cameras.length) % cameras.length;
    const next = (expandedIndex + 1) % cameras.length;
    return (
      <div className={`relative bg-black overflow-hidden ${className}`}>
        <CameraStream camera={cam} className="w-full h-full" showControls />
        <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
          <button
            onClick={() => setExpandedIndex(null)}
            className="p-1.5 bg-black/60 text-white rounded hover:bg-black/80 transition-colors"
            title="그리드로 돌아가기"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3.75 3.75v4.5m0-4.5h4.5M3.75 20.25v-4.5m0 4.5h4.5M20.25 3.75h-4.5m4.5 0v4.5M20.25 20.25h-4.5m4.5 0v-4.5" />
            </svg>
          </button>
          <button
            onClick={() => setExpandedIndex(prev)}
            className="p-1.5 bg-black/60 text-white rounded hover:bg-black/80 transition-colors"
            title="이전 카메라"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => setExpandedIndex(next)}
            className="p-1.5 bg-black/60 text-white rounded hover:bg-black/80 transition-colors"
            title="다음 카메라"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <span className="text-xs text-white/70 bg-black/50 px-2 py-0.5 rounded ml-1">
            {expandedIndex + 1} / {cameras.length}
          </span>
        </div>
      </div>
    );
  }

  // 그리드 모드
  const gridCols = 'grid-cols-2';
  const gridRows = cameras.length === 2 ? 'grid-rows-1' : 'grid-rows-2';

  return (
    <div className={`grid gap-0.5 bg-gray-800 ${gridCols} ${gridRows} ${className}`}>
      {cameras.map((cam, i) => (
        <div
          key={cam.id}
          className={`relative cursor-pointer group overflow-hidden bg-black min-h-0 ${
            cameras.length === 3 && i === 2 ? 'col-span-2' : ''
          }`}
          onClick={() => setExpandedIndex(i)}
        >
          <CameraStream camera={cam} className="w-full h-full" showControls={false} thumb />
          <div className="absolute inset-0 bg-transparent group-hover:bg-black/20 transition-colors pointer-events-none" />
          <div className="absolute bottom-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <span className="text-white text-xs bg-black/60 px-1.5 py-0.5 rounded">{cam.name}</span>
          </div>
          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <svg className="w-3.5 h-3.5 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}

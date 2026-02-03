// CameraStream - 실시간 영상 뷰어 컴포넌트 (mock + WebRTC 인터페이스)

import { useState, useEffect, useRef, useCallback } from 'react';
import { CameraConfig } from '../stores/cameraStore';

interface CameraStreamProps {
  camera?: CameraConfig;
  className?: string;
  showControls?: boolean;
}

type ConnectionState = 'idle' | 'connecting' | 'live' | 'error';

export function CameraStream({ camera, className = '', showControls = true }: CameraStreamProps) {
  const [connState, setConnState] = useState<ConnectionState>('idle');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mock 연결 시뮬레이션
  useEffect(() => {
    if (!camera || !camera.enabled) {
      setConnState('idle');
      return;
    }

    setConnState('connecting');
    const timer = setTimeout(() => {
      setConnState('live');
    }, 2000);

    return () => clearTimeout(timer);
  }, [camera]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // 카메라 미연결
  if (!camera) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 text-gray-500 ${className}`}>
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-sm">이 장비에 연결된 카메라가 없습니다</p>
          <p className="text-xs mt-1 text-gray-600">설정에서 카메라를 등록하세요</p>
        </div>
      </div>
    );
  }

  const rtspUrl = `rtsp://${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden ${className} ${isFullscreen ? 'w-screen h-screen' : ''}`}
    >
      {/* Mock 영상 영역 */}
      <div className="absolute inset-0 flex items-center justify-center">
        {connState === 'connecting' && (
          <div className="text-center text-gray-400">
            <div className="w-8 h-8 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm">연결 중...</p>
          </div>
        )}

        {connState === 'live' && (
          <>
            {/* Mock 영상 배경 (실제 연동 시 <video> 태그로 교체) */}
            <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800">
              {/* 스캔라인 효과 */}
              <div className="absolute inset-0 opacity-5"
                style={{
                  backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
                }}
              />
              {/* 중앙 카메라 정보 */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center opacity-20">
                  <svg className="w-16 h-16 mx-auto mb-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm text-gray-500">MOCK STREAM</p>
                </div>
              </div>
            </div>

            {/* 상단 오버레이: LIVE + 카메라명 */}
            <div className="absolute top-2 left-2 flex items-center gap-2">
              <span className="flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                LIVE
              </span>
              <span className="text-white text-xs bg-black/50 px-2 py-0.5 rounded">
                {camera.name}
              </span>
            </div>

            {/* 하단 오버레이: RTSP 정보 */}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <span className="text-xs text-gray-400 font-mono bg-black/50 px-2 py-0.5 rounded truncate">
                {rtspUrl}
              </span>
              <span className="text-xs text-gray-500 bg-black/50 px-2 py-0.5 rounded">
                1920x1080
              </span>
            </div>
          </>
        )}

        {connState === 'error' && (
          <div className="text-center text-red-400">
            <p className="text-sm font-medium">카메라 연결 실패</p>
            <p className="text-xs mt-1 text-gray-500">{camera.ipAddress}</p>
          </div>
        )}

        {connState === 'idle' && !camera.enabled && (
          <div className="text-center text-gray-500">
            <p className="text-sm">카메라 비활성화 상태</p>
          </div>
        )}
      </div>

      {/* 전체화면 버튼 */}
      {showControls && connState === 'live' && (
        <button
          onClick={toggleFullscreen}
          className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded hover:bg-black/70 transition-colors"
          title={isFullscreen ? '전체화면 종료' : '전체화면'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {isFullscreen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            )}
          </svg>
        </button>
      )}
    </div>
  );
}

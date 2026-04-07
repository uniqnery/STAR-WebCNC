// CameraStream — RTSP→MJPEG 실시간 스트림 뷰어
// 서버 /api/camera/:id/stream (FFmpeg 프록시) 을 <img> 태그로 표시
// TP-Link VIGI C350 기준 (전시용 구현)

import { useState, useEffect, useRef, useCallback } from 'react';
import { CameraConfig } from '../stores/cameraStore';
import { cameraServerApi } from '../lib/api';

interface CameraStreamProps {
  camera?: CameraConfig;
  className?: string;
  showControls?: boolean;
}

type ConnectionState = 'idle' | 'connecting' | 'live' | 'error' | 'auth_error' | 'disabled';

export function CameraStream({ camera, className = '', showControls = true }: CameraStreamProps) {
  const [connState, setConnState] = useState<ConnectionState>('idle');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 스트림 URL 갱신 및 연결 시작
  useEffect(() => {
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);

    if (!camera || !camera.enabled) {
      setConnState(camera ? 'disabled' : 'idle');
      setStreamUrl(null);
      return;
    }

    setConnState('connecting');
    setStreamUrl(null);

    // 연결 타임아웃 8초 — 첫 프레임이 오지 않으면 error
    connectTimeoutRef.current = setTimeout(() => {
      setConnState((prev) => (prev === 'connecting' ? 'error' : prev));
    }, 8000);

    // 서버에 설정 sync 후 스트림 URL 세팅
    const url = cameraServerApi.getStreamUrl(camera.id);
    setStreamUrl(url);

    return () => {
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    };
  }, [camera?.id, camera?.enabled]);

  // img onLoad — 첫 프레임 수신 = 연결 성공
  const handleLoad = useCallback(() => {
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    setConnState('live');
  }, []);

  // img onError — 연결 실패 (네트워크/인증/ffmpeg 오류)
  const handleError = useCallback(() => {
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    setConnState('error');
    setStreamUrl(null);
  }, []);

  // 재연결
  const handleRetry = useCallback(() => {
    if (!camera?.enabled) return;
    setConnState('connecting');
    setStreamUrl(null);

    connectTimeoutRef.current = setTimeout(() => {
      setConnState((prev) => (prev === 'connecting' ? 'error' : prev));
    }, 8000);

    // cache busting으로 브라우저 캐시 우회
    const url = cameraServerApi.getStreamUrl(camera.id) + `&t=${Date.now()}`;
    setStreamUrl(url);
  }, [camera]);

  // 전체화면
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

  // ── 카메라 미등록
  if (!camera) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 text-gray-500 ${className}`}>
        <div className="text-center">
          <CameraIcon className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">이 장비에 연결된 카메라가 없습니다</p>
          <p className="text-xs mt-1 text-gray-600">설정에서 카메라를 등록하세요</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden ${className} ${isFullscreen ? 'w-screen h-screen' : ''}`}
    >
      {/* 실제 MJPEG 스트림 img 태그 */}
      {streamUrl && (
        <img
          src={streamUrl}
          onLoad={handleLoad}
          onError={handleError}
          className="absolute inset-0 w-full h-full object-contain"
          alt={camera.name}
        />
      )}

      {/* 상태 오버레이 */}
      {connState === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center text-gray-400">
            <div className="w-8 h-8 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm">연결 중...</p>
            <p className="text-xs mt-1 text-gray-600">{camera.ipAddress}</p>
          </div>
        </div>
      )}

      {connState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90">
          <div className="text-center">
            <svg className="w-10 h-10 mx-auto mb-2 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.75L13.75 4a2 2 0 00-3.5 0L3.25 16.25A2 2 0 005.07 19z" />
            </svg>
            <p className="text-sm font-medium text-red-400">카메라 연결 실패</p>
            <p className="text-xs mt-1 text-gray-500">{camera.ipAddress}:{camera.rtspPort}</p>
            <button
              onClick={handleRetry}
              className="mt-3 px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
            >
              재연결
            </button>
          </div>
        </div>
      )}

      {connState === 'disabled' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="text-sm text-gray-500">카메라 비활성화 상태</p>
        </div>
      )}

      {/* LIVE 배지 + 카메라명 (연결 성공 시) */}
      {connState === 'live' && (
        <div className="absolute top-2 left-2 flex items-center gap-2 pointer-events-none">
          <span className="flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </span>
          <span className="text-white text-xs bg-black/50 px-2 py-0.5 rounded">
            {camera.name}
          </span>
        </div>
      )}

      {/* 컨트롤 버튼 */}
      {showControls && connState === 'live' && (
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            onClick={handleRetry}
            className="p-1.5 bg-black/50 text-white rounded hover:bg-black/70 transition-colors"
            title="새로고침"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-1.5 bg-black/50 text-white rounded hover:bg-black/70 transition-colors"
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
        </div>
      )}
    </div>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

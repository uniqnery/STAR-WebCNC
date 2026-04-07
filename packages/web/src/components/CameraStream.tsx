// CameraStream — RTSP→MJPEG 실시간 스트림 뷰어
// 서버 /api/camera/:id/stream (FFmpeg 프록시) → <img> 태그
//
// [자동 복구 정책 — 전시 모드]
// - 오류 시 지수 백오프 무제한 재시도 (3s → 5s → 10s → 20s → 최대 30s)
// - 카메라 재부팅/LAN 탈착/공유기 재시작 모두 자동 복구
// - 수동 재연결 버튼으로 즉시 재시도 가능

import { useState, useEffect, useRef, useCallback } from 'react';
import { CameraConfig } from '../stores/cameraStore';
import { cameraServerApi } from '../lib/api';

interface CameraStreamProps {
  camera?: CameraConfig;
  className?: string;
  showControls?: boolean;
}

type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'error'         // 일반 연결 오류 (재시도 중)
  | 'auth_error'    // 인증 실패 (재시도 없음)
  | 'network_error' // 네트워크 도달 불가 (재시도)
  | 'timeout'       // 프레임 미수신 타임아웃 (재시도)
  | 'stream_ended'  // 서버 측 스트림 종료 (재시도)
  | 'disabled';

// 지수 백오프 지연 시간 (ms) — 재시도 횟수에 따라 증가, 최대 30s
const BACKOFF_DELAYS = [3000, 5000, 10000, 20000, 30000];
const CONNECT_TIMEOUT_MS = 10000; // 첫 프레임 수신 타임아웃

function getBackoffDelay(retryCount: number): number {
  return BACKOFF_DELAYS[Math.min(retryCount, BACKOFF_DELAYS.length - 1)];
}

export function CameraStream({ camera, className = '', showControls = true }: CameraStreamProps) {
  const [connState, setConnState] = useState<ConnectionState>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [retryCount, setRetryCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const containerRef       = useRef<HTMLDivElement>(null);
  const connectTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef      = useRef(0);  // ref로도 유지 (closure 안에서 사용)
  const cameraIdRef        = useRef<string | undefined>(undefined);

  const clearTimers = useCallback(() => {
    if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
    if (retryTimerRef.current)     { clearTimeout(retryTimerRef.current);     retryTimerRef.current = null; }
  }, []);

  // 스트림 URL 생성 — force=true로 기존 스트림 교체 보장
  const buildStreamUrl = useCallback((cameraId: string, force = true) => {
    const base = cameraServerApi.getStreamUrl(cameraId);
    return `${base}&t=${Date.now()}${force ? '&force=true' : ''}`;
  }, []);

  const startStream = useCallback((cameraId: string) => {
    clearTimers();
    setConnState('connecting');
    setErrorMsg('');
    setStreamUrl(null);

    // 첫 프레임 미수신 타임아웃
    connectTimeoutRef.current = setTimeout(() => {
      setConnState('timeout');
      setErrorMsg('카메라 응답 없음 (타임아웃)');
      setStreamUrl(null);
    }, CONNECT_TIMEOUT_MS);

    setStreamUrl(buildStreamUrl(cameraId));
  }, [clearTimers, buildStreamUrl]);

  // 카메라 변경 시 재시도 카운터 리셋
  useEffect(() => {
    clearTimers();
    retryCountRef.current = 0;
    setRetryCount(0);
    cameraIdRef.current = camera?.id;

    if (!camera || !camera.enabled) {
      setConnState(camera ? 'disabled' : 'idle');
      setStreamUrl(null);
      return;
    }

    startStream(camera.id);
    return clearTimers;
  }, [camera?.id, camera?.enabled, startStream, clearTimers]);

  // 오류 후 지수 백오프 재시도 스케줄
  const scheduleRetry = useCallback((state: ConnectionState, msg: string) => {
    if (!cameraIdRef.current) return;
    const delay = getBackoffDelay(retryCountRef.current);
    retryCountRef.current += 1;
    setRetryCount(retryCountRef.current);
    setConnState(state);
    setErrorMsg(msg);
    setStreamUrl(null);
    console.log(`[CameraStream] Retry #${retryCountRef.current} in ${delay}ms (${state})`);
    retryTimerRef.current = setTimeout(() => {
      if (cameraIdRef.current) startStream(cameraIdRef.current);
    }, delay);
  }, [startStream]);

  // ── img 이벤트 핸들러
  const handleLoad = useCallback(() => {
    clearTimers();
    retryCountRef.current = 0;
    setRetryCount(0);
    setConnState('live');
    setErrorMsg('');
  }, [clearTimers]);

  const handleError = useCallback(() => {
    // img onError는 HTTP 상태코드 미노출 — 서버에서 스트림 거부(4xx/5xx) 시 발생
    // 인증 오류는 타임아웃 전 빠르게 발생 → auth_error 구분은 서버 probe로만 가능
    // 전시 환경: 재시도 우선, 인증 오류도 계속 재시도 (카메라 설정 변경 시 복구)
    scheduleRetry('error', '연결 오류 — 자동 재시도 중');
  }, [scheduleRetry]);

  // 타임아웃 발생 후 자동 재시도
  useEffect(() => {
    if (connState === 'timeout' && cameraIdRef.current) {
      scheduleRetry('timeout', '카메라 응답 없음 — 자동 재시도 중');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connState]);

  // 수동 재연결 — 카운터 리셋 후 즉시 재시도
  const handleRetry = useCallback(() => {
    if (!cameraIdRef.current) return;
    retryCountRef.current = 0;
    setRetryCount(0);
    startStream(cameraIdRef.current);
  }, [startStream]);

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

  const isRetrying = connState !== 'live' && connState !== 'idle' && connState !== 'disabled' && retryCount > 0;
  const nextRetryDelay = Math.round(getBackoffDelay(retryCountRef.current) / 1000);

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden ${className} ${isFullscreen ? 'w-screen h-screen' : ''}`}
    >
      {/* MJPEG 스트림 */}
      {streamUrl && (
        <img
          src={streamUrl}
          onLoad={handleLoad}
          onError={handleError}
          className="absolute inset-0 w-full h-full object-contain"
          alt={camera.name}
        />
      )}

      {/* 연결 중 오버레이 */}
      {connState === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center text-gray-400">
            <div className="w-8 h-8 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm">{isRetrying ? `재연결 중... (${retryCount}회차)` : '연결 중...'}</p>
            <p className="text-xs mt-1 text-gray-600">{camera.ipAddress}</p>
          </div>
        </div>
      )}

      {/* 오류 오버레이 (재시도 대기 중) */}
      {(connState === 'error' || connState === 'network_error' || connState === 'timeout' || connState === 'stream_ended') && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90">
          <div className="text-center px-4">
            <svg className="w-10 h-10 mx-auto mb-2 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.75L13.75 4a2 2 0 00-3.5 0L3.25 16.25A2 2 0 005.07 19z" />
            </svg>
            <p className="text-sm font-medium text-yellow-400">
              {connState === 'timeout'      ? '타임아웃'      :
               connState === 'stream_ended' ? '스트림 종료'   :
               connState === 'network_error'? '네트워크 오류' : '연결 오류'}
            </p>
            {errorMsg && <p className="text-xs mt-1 text-gray-400">{errorMsg}</p>}
            <p className="text-xs mt-1 text-gray-600">{camera.ipAddress}:{camera.rtspPort}</p>
            <p className="text-xs mt-2 text-gray-500">
              {nextRetryDelay}초 후 자동 재시도 ({retryCount}회 시도됨)
            </p>
            <button
              onClick={handleRetry}
              className="mt-3 px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
            >
              지금 재연결
            </button>
          </div>
        </div>
      )}

      {/* 인증 오류 — 설정 확인 안내 */}
      {connState === 'auth_error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90">
          <div className="text-center px-4">
            <svg className="w-10 h-10 mx-auto mb-2 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-sm font-medium text-red-400">인증 실패</p>
            <p className="text-xs mt-1 text-gray-400">카메라 ID/PW를 확인하세요</p>
            <button onClick={handleRetry} className="mt-3 px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors">
              재시도
            </button>
          </div>
        </div>
      )}

      {connState === 'disabled' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="text-sm text-gray-500">카메라 비활성화 상태</p>
        </div>
      )}

      {/* LIVE 배지 */}
      {connState === 'live' && (
        <div className="absolute top-2 left-2 flex items-center gap-2 pointer-events-none">
          <span className="flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </span>
          <span className="text-white text-xs bg-black/50 px-2 py-0.5 rounded">{camera.name}</span>
        </div>
      )}

      {/* 컨트롤 버튼 */}
      {showControls && connState === 'live' && (
        <div className="absolute top-2 right-2 flex gap-1">
          <button onClick={handleRetry} className="p-1.5 bg-black/50 text-white rounded hover:bg-black/70 transition-colors" title="새로고침">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button onClick={toggleFullscreen} className="p-1.5 bg-black/50 text-white rounded hover:bg-black/70 transition-colors" title={isFullscreen ? '전체화면 종료' : '전체화면'}>
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

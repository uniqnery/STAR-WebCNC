// Camera Routes — RTSP → MJPEG 브로드캐스트
//
// [설계 정책]
// - 카메라 ID당 FFmpeg 프로세스 1개
// - 구독자(시청자) 무제한 — Set<Response> 브로드캐스트
// - 마지막 구독자 퇴장 시 FFmpeg 자동 종료
// - 해상도/FPS: CameraConfig.width / fps 설정값 사용 (기본 1280px / 20fps)

import { Router, Request, Response, NextFunction } from 'express';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { prisma } from '../lib/prisma';
import { verifyAccessToken, extractBearerToken } from '../auth/jwt';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string | null = require('ffmpeg-static');

const router = Router();

export interface CameraConfig {
  id: string;
  name: string;
  ipAddress: string;
  rtspPort: number;
  streamPath: string;
  username: string;
  password: string;
  enabled: boolean;
  assignedMachineId?: string;
  defaultZoom?: number;
  width?: number;  // FFmpeg 출력 가로 해상도 (기본 1280)
  fps?: number;    // FFmpeg 출력 FPS (기본 20)
}

export type CameraErrorCode =
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'STREAM_ENDED'
  | 'NOT_FOUND'
  | 'FFMPEG_ERROR'
  | 'INTERNAL_ERROR';

// ── Active stream 관리
interface ActiveStream {
  process: ChildProcessWithoutNullStreams;
  subscribers: Set<Response>;
  startedAt: number;
  graceTimer?: ReturnType<typeof setTimeout>; // 마지막 구독자 퇴장 후 유예 타이머
}
const activeStreams = new Map<string, ActiveStream>();

// 마지막 구독자 퇴장 후 FFmpeg 유지 시간 (재진입 시 재사용)
const GRACE_PERIOD_MS = 3_000;

process.on('SIGTERM', cleanupAllStreams);
process.on('SIGINT', cleanupAllStreams);
function cleanupAllStreams() {
  console.log(`[Camera] Server shutdown: cleaning up ${activeStreams.size} active stream(s)`);
  for (const [id, stream] of activeStreams) {
    stream.process.kill('SIGTERM');
    for (const sub of stream.subscribers) {
      if (!sub.writableEnded) sub.destroy();
    }
    activeStreams.delete(id);
  }
}

async function getCameraConfigs(): Promise<CameraConfig[]> {
  const row = await prisma.globalSetting.findUnique({ where: { key: 'camera.configs' } });
  if (!row) return [];
  return JSON.parse(row.value as string) as CameraConfig[];
}

function authenticateStream(req: Request, res: Response, next: NextFunction): void {
  const token =
    (req.query.token as string | undefined) ||
    extractBearerToken(req.headers.authorization);
  if (!token) { res.status(401).end(); return; }
  const payload = verifyAccessToken(token);
  if (!payload) { res.status(401).end(); return; }
  req.user = { id: payload.sub, username: payload.username, role: payload.role };
  next();
}

// ──────────────────────────────────────────────
// GET /api/camera/configs
// ──────────────────────────────────────────────
router.get('/configs', authenticateStream, async (_req: Request, res: Response) => {
  try {
    const cameras = await getCameraConfigs();
    const masked = cameras.map((c) => ({ ...c, password: c.password ? '●●●●●●' : '' }));
    return res.json({ success: true, data: masked });
  } catch (err) {
    console.error('[Camera] GET configs error:', err);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '카메라 설정 조회 실패' } });
  }
});

// ──────────────────────────────────────────────
// PUT /api/camera/configs
// ──────────────────────────────────────────────
router.put('/configs', authenticateStream, async (req: Request, res: Response) => {
  try {
    const cameras = req.body as CameraConfig[];
    if (!Array.isArray(cameras)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '배열 형식이어야 합니다' } });
    }
    const updatedBy = req.user?.username ?? 'unknown';
    await prisma.globalSetting.upsert({
      where:  { key: 'camera.configs' },
      update: { value: JSON.stringify(cameras), updatedBy },
      create: { key: 'camera.configs', value: JSON.stringify(cameras), updatedBy },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[Camera] PUT configs error:', err);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '카메라 설정 저장 실패' } });
  }
});

// ──────────────────────────────────────────────
// GET /api/camera/:id/status
// ──────────────────────────────────────────────
router.get('/:id/status', authenticateStream, (req: Request, res: Response) => {
  const { id } = req.params;
  const stream = activeStreams.get(id);
  return res.json({
    success: true,
    data: {
      id,
      streaming: !!stream,
      subscriberCount: stream?.subscribers.size ?? 0,
      startedAt: stream?.startedAt ?? null,
    },
  });
});

// ──────────────────────────────────────────────
// GET /api/camera/:id/stream?token=xxx
// 다중 구독자 지원 — 이미 실행 중인 FFmpeg에 구독자로 추가
// ──────────────────────────────────────────────
router.get('/:id/stream', authenticateStream, async (req: Request, res: Response) => {
  const { id } = req.params;
  const clientIp = req.ip ?? 'unknown';
  const isThumb = req.query.thumb === '1';
  const streamKey = isThumb ? `${id}:thumb` : id;

  if (!ffmpegPath) {
    return res.status(500).json({ success: false, error: { code: 'FFMPEG_ERROR' as CameraErrorCode, message: 'ffmpeg를 찾을 수 없습니다' } });
  }

  try {
    const cameras = await getCameraConfigs();
    const camera = cameras.find((c) => c.id === id && c.enabled);
    if (!camera) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' as CameraErrorCode, message: '카메라를 찾을 수 없거나 비활성 상태입니다' } });
    }

    // 응답 헤더 설정 (write 전까지 실제 전송되지 않음)
    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=ffmpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no');

    // [Fix1] await 이후 재확인 — getCameraConfigs() 대기 중 다른 요청이 스트림을 시작했을 수 있음
    const existing = activeStreams.get(streamKey);
    if (existing) {
      // [Fix2] 유예 타이머 취소 — 재진입 시 기존 FFmpeg 재사용
      if (existing.graceTimer) {
        clearTimeout(existing.graceTimer);
        existing.graceTimer = undefined;
      }
      existing.subscribers.add(res);
      console.log(`[Camera] Subscriber joined: ${id} (${clientIp}) — total: ${existing.subscribers.size}`);

      req.on('close', () => {
        existing.subscribers.delete(res);
        console.log(`[Camera] Subscriber left: ${id} (${clientIp}) — remaining: ${existing.subscribers.size}`);
        if (existing.subscribers.size === 0 && activeStreams.get(streamKey) === existing) {
          // [Fix2] 즉시 종료 대신 유예 기간 — 빠른 재진입 시 FFmpeg 재사용
          if (existing.graceTimer) clearTimeout(existing.graceTimer);
          existing.graceTimer = setTimeout(() => {
            if (activeStreams.get(streamKey) === existing && existing.subscribers.size === 0) {
              console.log(`[Camera] Grace expired — killing FFmpeg: ${id}`);
              existing.process.kill('SIGTERM');
              activeStreams.delete(streamKey);
            }
          }, GRACE_PERIOD_MS);
          console.log(`[Camera] Last subscriber left — grace ${GRACE_PERIOD_MS / 1000}s: ${id}`);
        }
      });
      return;
    }

    // 새 FFmpeg 프로세스 시작
    const auth = camera.username
      ? `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}@`
      : '';
    const rtspUrl     = `rtsp://${auth}${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;
    const rtspUrlSafe = `rtsp://${camera.username ? `${camera.username}:●●●@` : ''}${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;

    const width = isThumb ? 320 : (camera.width ?? 1280);
    const fps   = isThumb ? 1   : (camera.fps   ?? 20);

    const ffmpegArgs = [
      '-loglevel', 'warning',
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-vf', `scale=${width}:-2,fps=${fps}`,
      '-q:v', '3',
      '-threads', '4',
      '-f', 'mpjpeg',
      'pipe:1',
    ];

    console.log(`[Camera] Starting stream: ${streamKey} → ${rtspUrlSafe} (${width}px / ${fps}fps)`);

    const ff = spawn(ffmpegPath, ffmpegArgs);
    const stream: ActiveStream = {
      process: ff,
      subscribers: new Set([res]),
      startedAt: Date.now(),
    };
    activeStreams.set(streamKey, stream);

    // ── Watchdog: 10초간 데이터 없으면 FFmpeg 강제 종료
    const WATCHDOG_MS = 10_000;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const resetWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        if (activeStreams.get(streamKey) === stream) {
          console.log(`[Camera] Watchdog: no data for ${WATCHDOG_MS / 1000}s — killing FFmpeg (${id})`);
          ff.kill('SIGTERM');
          activeStreams.delete(streamKey);
          for (const sub of stream.subscribers) {
            if (!sub.writableEnded) sub.end();
          }
          stream.subscribers.clear();
        }
      }, WATCHDOG_MS);
    };
    resetWatchdog();
    ff.on('exit', () => { if (watchdogTimer) clearTimeout(watchdogTimer); });

    // ── stdout → 전체 구독자 브로드캐스트
    ff.stdout.on('data', (chunk: Buffer) => {
      resetWatchdog();
      for (const sub of stream.subscribers) {
        try {
          if (!sub.writableEnded && !sub.destroyed) {
            sub.write(chunk);
          }
        } catch {
          stream.subscribers.delete(sub);
        }
      }
    });

    // ── stderr 오류 감지 (첫 프레임 수신 전 — headersSent=false 상태)
    let stderrBuf = '';
    ff.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderrBuf += msg;
      const trimmed = msg.trim();
      if (trimmed) console.log(`[Camera:${id}] ${trimmed.replace(/:([^@]+)@/, ':●●●@')}`);

      if (res.headersSent) return;

      if (stderrBuf.includes('401') || stderrBuf.includes('Unauthorized')) {
        ff.kill('SIGTERM');
        activeStreams.delete(streamKey); // [Fix3] id → streamKey (thumb 스트림 좀비 방지)
        stream.subscribers.clear();
        res.status(401).json({ success: false, error: { code: 'AUTH_ERROR' as CameraErrorCode, message: '카메라 인증 실패 (ID/PW 확인)' } });
      } else if (stderrBuf.includes('Connection refused') || stderrBuf.includes('No route to host') || stderrBuf.includes('Connection timed out')) {
        ff.kill('SIGTERM');
        activeStreams.delete(streamKey); // [Fix3] id → streamKey (thumb 스트림 좀비 방지)
        stream.subscribers.clear();
        res.status(502).json({ success: false, error: { code: 'NETWORK_ERROR' as CameraErrorCode, message: '카메라에 접속할 수 없습니다 (IP/포트 확인)' } });
      }
    });

    // ── FFmpeg 종료 시 전체 구독자 스트림 종료 + 유예 타이머 정리
    ff.on('exit', (code, signal) => {
      console.log(`[Camera] Stream ended: ${id} (code=${code}, signal=${signal})`);
      if (stream.graceTimer) { clearTimeout(stream.graceTimer); stream.graceTimer = undefined; }
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (activeStreams.get(streamKey) === stream) activeStreams.delete(streamKey);
      for (const sub of stream.subscribers) {
        if (!sub.writableEnded) sub.end();
      }
      stream.subscribers.clear();
    });

    // ── 첫 구독자 연결 종료 처리
    req.on('close', () => {
      stream.subscribers.delete(res);
      console.log(`[Camera] Subscriber left: ${id} (${clientIp}) — remaining: ${stream.subscribers.size}`);
      if (stream.subscribers.size === 0 && activeStreams.get(streamKey) === stream) {
        // [Fix2] 즉시 종료 대신 유예 기간 — 빠른 재진입 시 FFmpeg 재사용
        if (stream.graceTimer) clearTimeout(stream.graceTimer);
        stream.graceTimer = setTimeout(() => {
          if (activeStreams.get(streamKey) === stream && stream.subscribers.size === 0) {
            console.log(`[Camera] Grace expired — killing FFmpeg: ${id}`);
            ff.kill('SIGTERM');
            activeStreams.delete(streamKey);
          }
        }, GRACE_PERIOD_MS);
        console.log(`[Camera] Last subscriber left — grace ${GRACE_PERIOD_MS / 1000}s: ${id}`);
      }
    });

  } catch (err) {
    console.error('[Camera] Stream error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' as CameraErrorCode, message: '스트림 시작 실패' } });
    }
  }
});

export default router;

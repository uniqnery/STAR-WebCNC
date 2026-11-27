// Camera Routes — RTSP → MJPEG 브로드캐스트
//
// [설계 정책]
// - 카메라 ID와 화질 조합당 FFmpeg 프로세스 1개
// - 구독자(시청자) 무제한 — Set<Response> 브로드캐스트
// - 마지막 구독자 퇴장 시 FFmpeg 자동 종료
// - 해상도/FPS: CameraConfig.width / fps 설정값 사용 (기본 1280px / 20fps)

import { Router, Request, Response, NextFunction } from 'express';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { prisma } from '../lib/prisma';
import { verifyAccessToken, extractBearerToken } from '../auth/jwt';
import { authenticate, requireRole } from '../middleware/auth';

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
  watchdogTimer?: ReturnType<typeof setTimeout>;
}
const activeStreams = new Map<string, ActiveStream>();

// 마지막 구독자 퇴장 후 FFmpeg 유지 시간 (재진입 시 재사용)
const GRACE_PERIOD_MS = 3_000;
const WATCHDOG_MS = 10_000;
const MAX_PENDING_BYTES = 2 * 1024 * 1024;

function closeStream(key: string, stream: ActiveStream, error?: {
  status: number;
  code: CameraErrorCode;
  message: string;
}) {
  if (activeStreams.get(key) !== stream) return;
  activeStreams.delete(key);
  clearTimeout(stream.graceTimer);
  clearTimeout(stream.watchdogTimer);
  const child = stream.process;
  if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  for (const sub of stream.subscribers) {
    if (sub.writableEnded || sub.destroyed) continue;
    if (error && !sub.headersSent) {
      sub.type('application/json').status(error.status).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    } else if (error) {
      sub.end();
    } else {
      sub.destroy();
    }
  }
  stream.subscribers.clear();
}

function removeSubscriber(key: string, stream: ActiveStream, res: Response) {
  if (!stream.subscribers.delete(res) || activeStreams.get(key) !== stream) return;
  console.log(`[Camera] Subscriber left: ${key} — remaining: ${stream.subscribers.size}`);
  if (stream.subscribers.size === 0) {
    stream.graceTimer = setTimeout(() => closeStream(key, stream), GRACE_PERIOD_MS);
  }
}

function addSubscriber(key: string, stream: ActiveStream, res: Response, clientIp: string) {
  clearTimeout(stream.graceTimer);
  stream.graceTimer = undefined;
  stream.subscribers.add(res);
  res.once('close', () => removeSubscriber(key, stream, res));
  console.log(`[Camera] Subscriber joined: ${key} (${clientIp}) — total: ${stream.subscribers.size}`);
}

process.on('SIGTERM', cleanupAllStreams);
process.on('SIGINT', cleanupAllStreams);
function cleanupAllStreams() {
  console.log(`[Camera] Server shutdown: cleaning up ${activeStreams.size} active stream(s)`);
  for (const [key, stream] of activeStreams) closeStream(key, stream);
}

async function getCameraConfigs(): Promise<CameraConfig[]> {
  const row = await prisma.globalSetting.findUnique({ where: { key: 'camera.configs' } });
  if (!row) return [];
  return JSON.parse(row.value as string) as CameraConfig[];
}

function authenticateStream(req: Request, res: Response, next: NextFunction): void {
  const token = (typeof req.query.token === 'string' && req.query.token) ||
    extractBearerToken(req.headers.authorization);
  if (!token) { res.status(401).end(); return; }
  const payload = verifyAccessToken(token);
  if (!payload) { res.status(401).end(); return; }
  req.user = { id: payload.sub, username: payload.username, displayName: payload.displayName || payload.username, role: payload.role };
  next();
}

const pilotCameraId = 'cam-1775703291746';
const pilotAsset = /^[\da-z_-]+\.(?:m3u8|mp4|m4s)$/i;
const pilotCookie = 'camera_pilot_access';

router.post('/:id/hls/session', (req, res) => {
  if (req.params.id !== pilotCameraId || process.env.CAMERA_HLS_PILOT === '0') return res.sendStatus(404);
  const token = extractBearerToken(req.headers.authorization);
  if (!token || !verifyAccessToken(token)) return res.sendStatus(401);
  return res.cookie(pilotCookie, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure || req.get('x-forwarded-proto') === 'https',
    path: `/api/camera/${pilotCameraId}/hls`,
  }).set('Cache-Control', 'no-store').json({ success: true });
});

router.get('/:id/hls/:asset', async (req, res) => {
  const { id, asset } = req.params;
  if (id !== pilotCameraId || !pilotAsset.test(asset) || process.env.CAMERA_HLS_PILOT === '0') {
    return res.sendStatus(404);
  }
  const token = req.cookies?.[pilotCookie];
  if (typeof token !== 'string' || !verifyAccessToken(token)) return res.sendStatus(401);
  try {
    const url = new URL(`http://127.0.0.1:8888/camera60/${asset}`);
    for (const key of ['session', '_HLS_msn', '_HLS_part', '_HLS_skip']) {
      const value = req.query[key];
      if (typeof value === 'string') url.searchParams.set(key, value);
    }
    const abort = new AbortController();
    res.once('close', () => abort.abort());
    const upstream = await fetch(url, {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return res.sendStatus(502);
    }
    res.set('Cache-Control', 'private, no-store');
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.type(contentType);
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    if (!res.destroyed) return res.sendStatus(502);
  }
});

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
router.put('/configs', authenticate, requireRole(['ADMIN', 'HQ_ENGINEER']), async (req: Request, res: Response) => {
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
    if (req.aborted || res.destroyed || res.writableEnded) return;
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

    const existing = activeStreams.get(streamKey);
    if (existing) {
      addSubscriber(streamKey, existing, res, clientIp);
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
      subscribers: new Set(),
      startedAt: Date.now(),
    };
    activeStreams.set(streamKey, stream);
    addSubscriber(streamKey, stream, res, clientIp);

    // ── Watchdog: 10초간 데이터 없으면 FFmpeg 강제 종료
    const resetWatchdog = () => {
      clearTimeout(stream.watchdogTimer);
      stream.watchdogTimer = setTimeout(() => {
        console.log(`[Camera] Watchdog: no data for ${WATCHDOG_MS / 1000}s — killing FFmpeg (${streamKey})`);
        closeStream(streamKey, stream, {
          status: 504,
          code: 'TIMEOUT',
          message: '카메라 응답 없음',
        });
      }, WATCHDOG_MS);
    };
    resetWatchdog();

    // ── stdout → 전체 구독자 브로드캐스트
    let receivedData = false;
    ff.stdout.on('data', (chunk: Buffer) => {
      if (activeStreams.get(streamKey) !== stream) return;
      receivedData = true;
      resetWatchdog();
      for (const sub of stream.subscribers) {
        if (sub.writableEnded || sub.destroyed || sub.writableLength >= MAX_PENDING_BYTES) {
          removeSubscriber(streamKey, stream, sub);
          if (!sub.writableEnded && !sub.destroyed) sub.destroy();
          continue;
        }
        try {
          sub.write(chunk);
        } catch {
          removeSubscriber(streamKey, stream, sub);
          sub.destroy();
        }
      }
    });

    // ── stderr 오류 감지 (첫 영상 데이터 수신 전)
    let stderrBuf = '';
    ff.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      const trimmed = msg.trim();
      if (trimmed) console.log(`[Camera:${streamKey}] ${trimmed.replace(/rtsp:\/\/[^\s/]*@/gi, 'rtsp://●●●@')}`);

      if (receivedData || activeStreams.get(streamKey) !== stream) return;
      stderrBuf = (stderrBuf + msg).slice(-4096);

      if (stderrBuf.includes('401') || stderrBuf.includes('Unauthorized')) {
        closeStream(streamKey, stream, { status: 401, code: 'AUTH_ERROR', message: '카메라 인증 실패 (ID/PW 확인)' });
      } else if (stderrBuf.includes('Connection refused') || stderrBuf.includes('No route to host') || stderrBuf.includes('Connection timed out')) {
        closeStream(streamKey, stream, { status: 502, code: 'NETWORK_ERROR', message: '카메라에 접속할 수 없습니다 (IP/포트 확인)' });
      }
    });

    ff.once('error', (err) => {
      console.error(`[Camera] FFmpeg error: ${streamKey} (${err.name})`);
      closeStream(streamKey, stream, { status: 500, code: 'FFMPEG_ERROR', message: 'FFmpeg 실행 실패' });
    });
    ff.once('close', (code, signal) => {
      console.log(`[Camera] Stream ended: ${streamKey} (code=${code}, signal=${signal})`);
      closeStream(streamKey, stream, { status: 502, code: 'STREAM_ENDED', message: '카메라 영상 연결 종료' });
    });

  } catch (err) {
    console.error('[Camera] Stream error:', err);
    if (!res.headersSent && !res.destroyed) {
      return res.type('application/json').status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' as CameraErrorCode, message: '스트림 시작 실패' } });
    }
  }
});

export default router;

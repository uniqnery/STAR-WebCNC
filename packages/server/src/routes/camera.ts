// Camera Routes — RTSP → MJPEG 프록시 스트림
//
// [설계 정책]
// - 카메라 ID당 FFmpeg 프로세스 1개 (단일 뷰어)
// - force=true: 기존 스트림 강제 종료 후 새 스트림 시작
// - force 없음: 409 BUSY 반환
// - 기존 클라이언트 res를 명시적으로 destroy — onError 확실히 발동

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
}

export type CameraErrorCode =
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'STREAM_ENDED'
  | 'BUSY'
  | 'NOT_FOUND'
  | 'FFMPEG_ERROR'
  | 'INTERNAL_ERROR';

// ──────────────────────────────────────────────
// Active stream 관리 — res 참조 보유로 강제 종료 가능
// ──────────────────────────────────────────────
interface ActiveStream {
  process: ChildProcessWithoutNullStreams;
  res: Response;          // 현재 스트림을 수신 중인 HTTP 응답
  startedAt: number;
  clientIp: string;
}
const activeStreams = new Map<string, ActiveStream>();

process.on('SIGTERM', cleanupAllStreams);
process.on('SIGINT',  cleanupAllStreams);
function cleanupAllStreams() {
  console.log(`[Camera] Server shutdown: cleaning up ${activeStreams.size} active stream(s)`);
  for (const [id, stream] of activeStreams) {
    stream.process.kill('SIGTERM');
    if (!stream.res.writableEnded) stream.res.destroy();
    activeStreams.delete(id);
  }
}

async function getCameraConfigs(): Promise<CameraConfig[]> {
  const row = await prisma.globalSetting.findUnique({ where: { key: 'camera.configs' } });
  if (!row) return [];
  return JSON.parse(row.value as string) as CameraConfig[];
}

// 기존 스트림 강제 종료 — res.destroy()로 클라이언트 연결 끊음 → onError 확실히 발동
function killStream(id: string) {
  const existing = activeStreams.get(id);
  if (!existing) return;
  existing.process.stdout.unpipe(existing.res);
  existing.process.kill('SIGTERM');
  if (!existing.res.writableEnded) existing.res.destroy();
  activeStreams.delete(id);
  console.log(`[Camera] Killed stream: ${id} (was running ${Date.now() - existing.startedAt}ms)`);
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
      startedAt: stream?.startedAt ?? null,
      clientIp: stream?.clientIp ?? null,
      totalActiveStreams: activeStreams.size,
    },
  });
});

// ──────────────────────────────────────────────
// GET /api/camera/:id/stream?token=xxx[&force=true]
// ──────────────────────────────────────────────
router.get('/:id/stream', authenticateStream, async (req: Request, res: Response) => {
  const { id } = req.params;
  const force = req.query.force === 'true';
  const clientIp = req.ip ?? 'unknown';

  if (!ffmpegPath) {
    return res.status(500).json({ success: false, error: { code: 'FFMPEG_ERROR' as CameraErrorCode, message: 'ffmpeg를 찾을 수 없습니다' } });
  }

  try {
    const cameras = await getCameraConfigs();
    const camera = cameras.find((c) => c.id === id && c.enabled);
    if (!camera) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' as CameraErrorCode, message: '카메라를 찾을 수 없거나 비활성 상태입니다' } });
    }

    const existing = activeStreams.get(id);
    if (existing) {
      if (!force) {
        console.log(`[Camera] BUSY: ${id} already streaming to ${existing.clientIp}, rejected ${clientIp}`);
        return res.status(409).json({
          success: false,
          error: { code: 'BUSY' as CameraErrorCode, message: '이미 다른 클라이언트가 이 카메라를 시청 중입니다.' },
        });
      }
      // force=true: 기존 클라이언트 강제 종료 후 RTSP 연결 해제 대기
      console.log(`[Camera] Force-replacing stream: ${id} (${existing.clientIp} → ${clientIp})`);
      killStream(id);
      await new Promise<void>((r) => setTimeout(r, 500));
    }

    const auth = camera.username
      ? `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}@`
      : '';
    const rtspUrl     = `rtsp://${auth}${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;
    const rtspUrlSafe = `rtsp://${camera.username ? `${camera.username}:●●●@` : ''}${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;

    const ffmpegArgs = [
      '-loglevel', 'warning',
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-vf', 'scale=1280:-2,fps=20',
      '-q:v', '3',
      '-threads', '4',
      '-f', 'mpjpeg',
      'pipe:1',
    ];

    console.log(`[Camera] Starting stream: ${id} → ${rtspUrlSafe} (client: ${clientIp})`);

    const ff = spawn(ffmpegPath, ffmpegArgs);
    activeStreams.set(id, { process: ff, res, startedAt: Date.now(), clientIp });

    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=ffmpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no');

    ff.stdout.pipe(res);

    let stderrBuf = '';
    ff.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderrBuf += msg;
      const trimmed = msg.trim();
      if (trimmed) console.log(`[Camera:${id}] ${trimmed.replace(/:([^@]+)@/, ':●●●@')}`);

      if (res.headersSent) return;

      if (stderrBuf.includes('401') || stderrBuf.includes('Unauthorized')) {
        ff.kill('SIGTERM');
        activeStreams.delete(id);
        res.status(401).json({ success: false, error: { code: 'AUTH_ERROR' as CameraErrorCode, message: '카메라 인증 실패 (ID/PW 확인)' } });
      } else if (stderrBuf.includes('Connection refused') || stderrBuf.includes('No route to host') || stderrBuf.includes('Connection timed out')) {
        ff.kill('SIGTERM');
        activeStreams.delete(id);
        res.status(502).json({ success: false, error: { code: 'NETWORK_ERROR' as CameraErrorCode, message: '카메라에 접속할 수 없습니다 (IP/포트 확인)' } });
      }
    });

    ff.on('exit', (code, signal) => {
      console.log(`[Camera] Stream ended: ${id} (code=${code}, signal=${signal})`);
      // 맵에 이 프로세스가 그대로 있을 때만 제거 (force 교체 후 덮어쓰인 경우 스킵)
      if (activeStreams.get(id)?.process === ff) activeStreams.delete(id);
      if (!res.writableEnded) res.end();
    });

    // 클라이언트가 먼저 연결 끊으면 FFmpeg 정리
    req.on('close', () => {
      // 맵에 이 프로세스가 그대로 있을 때만 정리 (force 교체 후면 스킵)
      if (activeStreams.get(id)?.process === ff) {
        console.log(`[Camera] Client disconnected: ${id} (${clientIp}) — killing FFmpeg`);
        ff.kill('SIGTERM');
        activeStreams.delete(id);
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

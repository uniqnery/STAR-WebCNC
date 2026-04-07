// Camera Routes — RTSP → MJPEG 프록시 스트림
// TP-Link VIGI C350 기준 (전시용 임시 구현)
// 브라우저 직접 재생: <img src="/api/camera/:id/stream?token=xxx">

import { Router, Request, Response, NextFunction } from 'express';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { prisma } from '../lib/prisma';
import { verifyAccessToken, extractBearerToken } from '../auth/jwt';

// ffmpeg-static — 빌드된 ffmpeg.exe 경로 (별도 설치 불필요)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string | null = require('ffmpeg-static');

const router = Router();

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
export interface CameraConfig {
  id: string;
  name: string;
  ipAddress: string;
  rtspPort: number;
  streamPath: string;      // e.g. /stream2
  username: string;
  password: string;        // plaintext (서버 내부에서만 사용)
  enabled: boolean;
  assignedMachineId?: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
async function getCameraConfigs(): Promise<CameraConfig[]> {
  const row = await prisma.globalSetting.findUnique({ where: { key: 'camera.configs' } });
  if (!row) return [];
  return JSON.parse(row.value as string) as CameraConfig[];
}

// 스트림 엔드포인트 전용 인증 — Authorization 헤더 또는 ?token= 쿼리 파라미터 허용
// <img src="...?token=xxx"> 방식 지원을 위해 쿼리 파라미터도 허용
function authenticateStream(req: Request, res: Response, next: NextFunction): void {
  const token =
    (req.query.token as string | undefined) ||
    extractBearerToken(req.headers.authorization);

  if (!token) {
    res.status(401).end();
    return;
  }
  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).end();
    return;
  }
  req.user = { id: payload.sub, username: payload.username, role: payload.role };
  next();
}

// ──────────────────────────────────────────────
// Active stream 관리 (cleanup용)
// ──────────────────────────────────────────────
const activeStreams = new Map<string, ChildProcessWithoutNullStreams>();

// ──────────────────────────────────────────────
// GET /api/camera/configs
// 카메라 설정 목록 조회 (비밀번호 마스킹 후 반환)
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
// 카메라 설정 전체 저장 (클라이언트에서 push)
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
// 스트림 활성 여부 조회
// ──────────────────────────────────────────────
router.get('/:id/status', authenticateStream, async (req: Request, res: Response) => {
  const { id } = req.params;
  return res.json({ success: true, data: { id, streaming: activeStreams.has(id) } });
});

// ──────────────────────────────────────────────
// GET /api/camera/:id/stream?token=xxx
// RTSP → MJPEG multipart 프록시 스트림
// 브라우저: <img src="/api/camera/cam-001/stream?token=xxx">
// ──────────────────────────────────────────────
router.get('/:id/stream', authenticateStream, async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!ffmpegPath) {
    return res.status(500).json({ success: false, error: { code: 'FFMPEG_NOT_FOUND', message: 'ffmpeg를 찾을 수 없습니다' } });
  }

  try {
    const cameras = await getCameraConfigs();
    const camera = cameras.find((c) => c.id === id && c.enabled);

    if (!camera) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '카메라를 찾을 수 없거나 비활성 상태입니다' } });
    }

    // 이미 해당 카메라 스트림 실행 중이면 이전 프로세스 종료 (새 연결로 교체)
    const existing = activeStreams.get(id);
    if (existing) {
      existing.kill('SIGTERM');
      activeStreams.delete(id);
    }

    // RTSP URL 구성 (인증 포함, URL 인코딩으로 특수문자 처리)
    const auth = camera.username
      ? `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}@`
      : '';
    const rtspUrl = `rtsp://${auth}${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;
    // 로그에는 비밀번호 마스킹
    const rtspUrlSafe = `rtsp://${camera.username ? camera.username + ':●●●@' : ''}${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;

    const ffmpegArgs = [
      '-loglevel', 'warning',
      '-rtsp_transport', 'tcp',    // TCP 모드: NAT/공유기 환경에서 안정적
      '-i', rtspUrl,
      '-f', 'mpjpeg',              // multipart/x-mixed-replace MJPEG 출력
      '-vf', 'scale=640:-1',       // 640px 너비 축소 (부하 절감)
      '-r', '10',                   // 10fps
      '-q:v', '5',                  // JPEG 품질 (1=최고, 31=최저)
      'pipe:1',
    ];

    console.log(`[Camera] Starting stream: ${id} → ${rtspUrlSafe}`);

    const ff = spawn(ffmpegPath, ffmpegArgs);
    activeStreams.set(id, ff);

    // MJPEG multipart 응답 헤더
    // X-Accel-Buffering: no — nginx/프록시 버퍼링 비활성화 (스트림 지연 방지)
    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=ffmpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no');

    ff.stdout.pipe(res);

    // stderr 파싱 — 인증 실패 감지 (401 Unauthorized)
    let stderrBuf = '';
    ff.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderrBuf += msg;
      const trimmed = msg.trim();
      if (trimmed) console.log(`[Camera:${id}] ${trimmed}`);

      // 인증 실패 감지 후 응답 헤더 미전송 상태면 401 반환
      if ((stderrBuf.includes('401') || stderrBuf.includes('Unauthorized') || stderrBuf.includes('Authorization')) && !res.headersSent) {
        ff.kill('SIGTERM');
        activeStreams.delete(id);
        res.status(401).json({ success: false, error: { code: 'AUTH_ERROR', message: '카메라 인증 실패 (ID/PW 확인)' } });
      }
    });

    ff.on('exit', (code, signal) => {
      console.log(`[Camera] Stream ended: ${id} (code=${code}, signal=${signal})`);
      activeStreams.delete(id);
      if (!res.writableEnded) res.end();
    });

    // 클라이언트 연결 종료 시 ffmpeg 정리
    req.on('close', () => {
      console.log(`[Camera] Client disconnected: ${id}`);
      ff.kill('SIGTERM');
      activeStreams.delete(id);
    });

  } catch (err) {
    console.error('[Camera] Stream error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '스트림 시작 실패' } });
    }
  }
});

export default router;

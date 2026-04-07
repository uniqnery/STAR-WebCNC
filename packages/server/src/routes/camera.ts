// Camera Routes — RTSP → MJPEG 프록시 스트림
// TP-Link VIGI C350 기준 (전시용 임시 구현)
//
// [설계 정책]
// - 카메라 ID당 FFmpeg 프로세스 1개 유지 (공유 방식)
// - 동시 접속 정책: 전시 단일 뷰어 전제 — 동일 카메라에 새 연결 요청 시
//   ?force=true 파라미터 없으면 409 Conflict 반환 (기존 스트림 보호)
//   ?force=true 있으면 기존 스트림 종료 후 새 스트림 시작
// - FFmpeg 옵션: 480px / 5fps / q:v 8 / threads 2
//   → CPU ~15~30% (노트북 기준), 메모리 ~30MB
//   → MJPEG는 -preset/-tune 미지원 (H264 전용 옵션)
//
// [브라우저 사용법]
// <img src="/api/camera/:id/stream?token=JWT_TOKEN">
// <img src="/api/camera/:id/stream?token=JWT_TOKEN&force=true">  // 강제 교체

import { Router, Request, Response, NextFunction } from 'express';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { prisma } from '../lib/prisma';
import { verifyAccessToken, extractBearerToken } from '../auth/jwt';

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
  password: string;        // plaintext (서버 내부 전용)
  enabled: boolean;
  assignedMachineId?: string;
}

export type CameraErrorCode =
  | 'AUTH_ERROR'       // RTSP 인증 실패
  | 'NETWORK_ERROR'    // 카메라 접속 불가
  | 'TIMEOUT'          // 연결 타임아웃
  | 'STREAM_ENDED'     // 스트림 정상/비정상 종료
  | 'BUSY'             // 이미 다른 클라이언트가 시청 중
  | 'NOT_FOUND'        // 카메라 설정 없음
  | 'FFMPEG_ERROR'     // FFmpeg 내부 오류
  | 'INTERNAL_ERROR';

// ──────────────────────────────────────────────
// Active stream 관리
// ──────────────────────────────────────────────
interface ActiveStream {
  process: ChildProcessWithoutNullStreams;
  startedAt: number;
  clientIp: string;
}
const activeStreams = new Map<string, ActiveStream>();

// 서버 종료 시 모든 FFmpeg 프로세스 정리
process.on('SIGTERM', cleanupAllStreams);
process.on('SIGINT',  cleanupAllStreams);
function cleanupAllStreams() {
  console.log(`[Camera] Server shutdown: cleaning up ${activeStreams.size} active stream(s)`);
  for (const [id, stream] of activeStreams) {
    stream.process.kill('SIGTERM');
    activeStreams.delete(id);
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
async function getCameraConfigs(): Promise<CameraConfig[]> {
  const row = await prisma.globalSetting.findUnique({ where: { key: 'camera.configs' } });
  if (!row) return [];
  return JSON.parse(row.value as string) as CameraConfig[];
}

function killStream(id: string) {
  const existing = activeStreams.get(id);
  if (existing) {
    existing.process.kill('SIGTERM');
    activeStreams.delete(id);
    console.log(`[Camera] Killed stream: ${id} (was running ${Date.now() - existing.startedAt}ms)`);
  }
}

// <img src="...?token=xxx"> 방식 지원 — 쿼리 파라미터 또는 Authorization 헤더 허용
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
// 스트림 활성 여부 + 활성 스트림 수 (디버깅용)
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
// RTSP → MJPEG multipart 프록시 스트림
//
// [FFmpeg 옵션 선정 근거]
// - scale=480:-2  : 480px 너비 (640보다 CPU ~40% 절감, -2로 짝수 강제)
// - fps=5         : 5fps (CNC 모니터링에 충분, 10fps 대비 CPU ~50% 절감)
// - q:v 8         : JPEG 품질 (5보다 파일 크기 ~30% 감소)
// - threads 2     : Node.js 프로세스와 CPU 공유 최소화
// - MJPEG는 -preset/-tune 미지원 (H264 전용, 적용 불가)
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

    // 동시 접속 정책: 전시 단일 뷰어 보호
    // force=true 없으면 기존 스트림 유지, 409 반환
    const existing = activeStreams.get(id);
    if (existing) {
      if (!force) {
        console.log(`[Camera] Rejected duplicate connection to ${id} from ${clientIp} (use ?force=true to override)`);
        return res.status(409).json({
          success: false,
          error: {
            code: 'BUSY' as CameraErrorCode,
            message: '이미 다른 클라이언트가 이 카메라를 시청 중입니다. ?force=true 로 강제 전환 가능합니다.',
          },
        });
      }
      // force=true: 기존 스트림 종료 후 새 연결
      killStream(id);
    }

    // RTSP URL (비밀번호 URL 인코딩 — 특수문자 처리)
    const auth = camera.username
      ? `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}@`
      : '';
    const rtspUrl     = `rtsp://${auth}${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;
    const rtspUrlSafe = `rtsp://${camera.username ? `${camera.username}:●●●@` : ''}${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;

    // FFmpeg 최적화 옵션
    const ffmpegArgs = [
      '-loglevel', 'warning',
      '-rtsp_transport', 'tcp',          // TCP: NAT/공유기 환경 안정적
      '-i', rtspUrl,
      '-vf', 'scale=480:-2,fps=5',       // 480px / 5fps — 부하 최소화
      '-q:v', '8',                        // JPEG 품질 (낮을수록 고품질/고부하)
      '-threads', '2',                    // CPU 스레드 제한
      '-f', 'mpjpeg',                     // multipart/x-mixed-replace MJPEG
      'pipe:1',
    ];

    console.log(`[Camera] Starting stream: ${id} → ${rtspUrlSafe} (client: ${clientIp})`);

    const ff = spawn(ffmpegPath, ffmpegArgs);
    activeStreams.set(id, { process: ff, startedAt: Date.now(), clientIp });

    // 응답 헤더
    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=ffmpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx 프록시 버퍼링 방지

    ff.stdout.pipe(res);

    // stderr 파싱 — 인증/네트워크 오류 감지
    let stderrBuf = '';
    ff.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderrBuf += msg;
      const trimmed = msg.trim();
      // 비밀번호 마스킹 후 로그 출력
      if (trimmed) {
        const masked = trimmed.replace(/:([^@]+)@/, ':●●●@');
        console.log(`[Camera:${id}] ${masked}`);
      }

      if (res.headersSent) return; // 이미 스트림 시작 후면 상태코드 변경 불가

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
      const duration = activeStreams.get(id) ? Date.now() - (activeStreams.get(id)?.startedAt ?? 0) : 0;
      console.log(`[Camera] Stream ended: ${id} (code=${code}, signal=${signal}, duration=${duration}ms)`);
      activeStreams.delete(id);
      if (!res.writableEnded) res.end();
    });

    // 클라이언트 연결 종료 → FFmpeg 정리
    req.on('close', () => {
      console.log(`[Camera] Client disconnected: ${id} (${clientIp})`);
      killStream(id);
    });

  } catch (err) {
    console.error('[Camera] Stream error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' as CameraErrorCode, message: '스트림 시작 실패' } });
    }
  }
});

export default router;

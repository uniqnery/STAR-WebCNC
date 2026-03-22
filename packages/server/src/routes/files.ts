// Files Routes - DNC 저장소 / 공유 폴더 파일 관리 API
//   SCHEDULER_REPO : data/repo/{machineId}/{pathKey}/
//   TRANSFER_SHARE : data/share/
//   CNC_LOCAL      : CNC 내부 파일 (FOCAS2 경유 — 전송 명령 시 MQTT)

import { Router, Request, Response, NextFunction } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { mqttService, TOPICS } from '../lib/mqtt';
import { createAuditLog } from './audit';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

// ── 기본 스토리지 경로 ────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const REPO_DIR  = path.join(DATA_DIR, 'repo');   // SCHEDULER_REPO
const SHARE_DIR = path.join(DATA_DIR, 'share');  // TRANSFER_SHARE

// ── 유틸리티 ──────────────────────────────────────────────────

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// 경로 순회 공격 방지 (path component 검증)
function isSafe(s: string): boolean {
  return Boolean(s) && !s.includes('..') && !path.isAbsolute(s);
}

interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  programNo?: string;
}

async function readDirEntries(dir: string): Promise<FileEntry[]> {
  try {
    await ensureDir(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const result: FileEntry[] = [];
    for (const entry of entries) {
      const stat = await fs.stat(path.join(dir, entry.name));
      const programNo = entry.name.match(/^O?\d+/i)?.[0]?.toUpperCase();
      result.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ...(programNo && !entry.isDirectory() ? { programNo } : {}),
      });
    }
    return result;
  } catch {
    return [];
  }
}

// ── 인증 전용 미들웨어 ─────────────────────────────────────────
router.use(authenticate);

// ─────────────────────────────────────────────────────────────
// GET /api/files/share
// PC 공용 저장소 파일 목록
// ─────────────────────────────────────────────────────────────
router.get('/share', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await readDirEntries(SHARE_DIR);
    return res.json({ success: true, data: entries });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/files/share/upload
// 외부 PC → 서버 share 폴더에 파일 업로드 (multipart)
// ─────────────────────────────────────────────────────────────
router.post('/share/upload', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '파일이 없습니다' } });
    }
    if (!isSafe(file.originalname)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_NAME', message: '파일명이 유효하지 않습니다' } });
    }

    await ensureDir(SHARE_DIR);
    const filePath = path.join(SHARE_DIR, file.originalname);
    await fs.writeFile(filePath, file.buffer);

    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'files.upload',
      targetType: 'file',
      targetId: file.originalname,
      params: { size: file.size },
      result: 'success',
      ipAddress: req.ip ?? 'unknown',
    });

    const stat = await fs.stat(filePath);
    return res.json({
      success: true,
      data: { name: file.originalname, size: stat.size, modifiedAt: stat.mtime.toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/files/repo/:machineId/:pathKey
// DNC 저장소 파일 목록 (pathKey: path1 | path2 | path3 ...)
// ─────────────────────────────────────────────────────────────
router.get('/repo/:machineId/:pathKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId, pathKey } = req.params;
    if (!isSafe(machineId) || !isSafe(pathKey)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PATH', message: '잘못된 경로입니다' } });
    }
    const dir = path.join(REPO_DIR, machineId, pathKey);
    const entries = await readDirEntries(dir);
    return res.json({ success: true, data: entries });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/files/read?root=SCHEDULER_REPO|TRANSFER_SHARE&machineId=...&name=...
// 파일 내용 읽기
// ─────────────────────────────────────────────────────────────
router.get('/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { root, machineId, name } = req.query as Record<string, string>;
    if (!name || !isSafe(name)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_NAME', message: '파일명이 유효하지 않습니다' } });
    }

    let filePath: string;
    if (root === 'TRANSFER_SHARE') {
      filePath = path.join(SHARE_DIR, name);
    } else if (root === 'SCHEDULER_REPO') {
      if (!machineId || !isSafe(machineId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MACHINE', message: '장비 ID가 유효하지 않습니다' } });
      }
      filePath = path.join(REPO_DIR, machineId, name);
    } else {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ROOT', message: '저장소 유형이 유효하지 않습니다' } });
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return res.json({ success: true, data: { content, fileName: name } });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return res.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
    }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/files/write
// 파일 저장 (신규 생성 또는 덮어쓰기)
// Body: { root, machineId?, fileName, content }
// ─────────────────────────────────────────────────────────────
router.put('/write', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { root, machineId, fileName, content } = req.body as Record<string, string>;
    if (!fileName || !isSafe(fileName)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_NAME', message: '파일명이 유효하지 않습니다' } });
    }

    let filePath: string;
    if (root === 'TRANSFER_SHARE') {
      await ensureDir(SHARE_DIR);
      filePath = path.join(SHARE_DIR, fileName);
    } else if (root === 'SCHEDULER_REPO') {
      if (!machineId || !isSafe(machineId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MACHINE', message: '장비 ID가 유효하지 않습니다' } });
      }
      const dir = path.join(REPO_DIR, machineId);
      await ensureDir(dir);
      filePath = path.join(dir, fileName);
    } else {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ROOT', message: '저장소 유형이 유효하지 않습니다' } });
    }

    await fs.writeFile(filePath, content ?? '', 'utf-8');

    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'files.write',
      targetType: 'file',
      targetId: fileName,
      params: { root, machineId, size: (content ?? '').length },
      result: 'success',
      ipAddress: req.ip ?? 'unknown',
    });

    const stat = await fs.stat(filePath);
    return res.json({ success: true, data: { fileName, size: stat.size, modifiedAt: stat.mtime.toISOString() } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/files/delete
// 파일 삭제
// Body: { root, machineId?, fileNames: string[] }
// ─────────────────────────────────────────────────────────────
router.post('/delete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { root, machineId, fileNames } = req.body as { root: string; machineId?: string; fileNames: string[] };
    if (!Array.isArray(fileNames) || fileNames.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILES', message: '삭제할 파일이 없습니다' } });
    }
    if (fileNames.some((n) => !isSafe(n))) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_NAME', message: '유효하지 않은 파일명이 포함되어 있습니다' } });
    }

    let baseDir: string;
    if (root === 'TRANSFER_SHARE') {
      baseDir = SHARE_DIR;
    } else if (root === 'SCHEDULER_REPO') {
      if (!machineId || !isSafe(machineId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MACHINE', message: '장비 ID가 유효하지 않습니다' } });
      }
      baseDir = path.join(REPO_DIR, machineId);
    } else {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ROOT', message: '저장소 유형이 유효하지 않습니다' } });
    }

    const results: { name: string; deleted: boolean }[] = [];
    for (const name of fileNames) {
      try {
        await fs.unlink(path.join(baseDir, name));
        results.push({ name, deleted: true });
      } catch {
        results.push({ name, deleted: false });
      }
    }

    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'files.delete',
      targetType: 'file',
      targetId: fileNames.join(','),
      params: { root, machineId, count: fileNames.length },
      result: 'success',
      ipAddress: req.ip ?? 'unknown',
    });

    return res.json({ success: true, data: { results } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/files/transfer
// PC ↔ CNC 프로그램 전송
// Body: { machineId, direction: 'PC_TO_CNC' | 'CNC_TO_PC', fileNames, conflictPolicy }
//
//  PC_TO_CNC: share/ → MQTT UPLOAD_PROGRAM → Agent
//  CNC_TO_PC: MQTT DOWNLOAD_PROGRAM → Agent → share/ (비동기, 현재는 즉시 응답)
// ─────────────────────────────────────────────────────────────
router.post('/transfer', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId, direction, fileNames, conflictPolicy = 'OVERWRITE' } = req.body as {
      machineId: string;
      direction: 'PC_TO_CNC' | 'CNC_TO_PC';
      fileNames: string[];
      conflictPolicy: string;
    };

    if (!machineId || !isSafe(machineId)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_MACHINE', message: '장비 ID가 유효하지 않습니다' } });
    }
    if (!Array.isArray(fileNames) || fileNames.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILES', message: '전송할 파일이 없습니다' } });
    }

    const correlationId = `xfer-${Date.now()}`;
    const jobs: Array<{ fileName: string; correlationId: string }> = [];

    if (direction === 'PC_TO_CNC') {
      // Share 폴더에서 파일 읽어 MQTT로 Agent에 전송
      for (const fileName of fileNames) {
        if (!isSafe(fileName)) continue;
        const filePath = path.join(SHARE_DIR, fileName);
        let content = '';
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch {
          // 파일 없으면 빈 내용으로 명령 발송
        }
        const jobCid = `${correlationId}-${fileName}`;
        mqttService.publish(TOPICS.COMMAND_TO(machineId), {
          timestamp: new Date().toISOString(),
          command: 'UPLOAD_PROGRAM',
          correlationId: jobCid,
          params: { fileName, content, conflictPolicy },
        });
        jobs.push({ fileName, correlationId: jobCid });
      }
    } else {
      // CNC → PC: Agent에 다운로드 명령 발송 (결과는 비동기 MQTT 수신)
      for (const fileName of fileNames) {
        if (!isSafe(fileName)) continue;
        const jobCid = `${correlationId}-${fileName}`;
        mqttService.publish(TOPICS.COMMAND_TO(machineId), {
          timestamp: new Date().toISOString(),
          command: 'DOWNLOAD_PROGRAM',
          correlationId: jobCid,
          params: { fileName, conflictPolicy },
        });
        jobs.push({ fileName, correlationId: jobCid });
      }
    }

    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: direction === 'PC_TO_CNC' ? 'transfer.pc_to_cnc' : 'transfer.cnc_to_pc',
      targetType: 'machine',
      targetId: machineId,
      params: { fileNames, conflictPolicy, jobCount: jobs.length },
      result: 'success',
      ipAddress: req.ip ?? 'unknown',
    });

    return res.json({
      success: true,
      data: { correlationId, jobs, machineId, direction },
    });
  } catch (err) {
    next(err);
  }
});

export default router;

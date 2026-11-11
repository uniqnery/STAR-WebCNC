// Files Routes - 프로그램 저장소 / 공유 폴더 파일 관리 API
//   SCHEDULER_REPO : data/repo/{machineId}/{pathKey}/
//   TRANSFER_SHARE : data/share/
//   CNC_LOCAL      : CNC 내부 파일 (FOCAS2 경유 — 전송 명령 시 MQTT)

import { Router, Request, Response, NextFunction } from 'express';
import { createHash, randomUUID } from 'crypto';
import { mkdirSync, promises as fs } from 'fs';
import path from 'path';
import multer from 'multer';
import { authenticate, requireRole } from '../middleware/auth';
import { mqttService, TOPICS } from '../lib/mqtt';
import { prisma } from '../lib/prisma';
import { listFileOperationHistory, recordFileOperation } from '../lib/fileOperationHistory';
import { createAuditLog } from './audit';
import { PROGRAM_REPOSITORY_DIR, formatProgramNo, normalizeProgramNo, resolveProgramRepositoryPath1 } from '../lib/programRepository';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

// content의 첫 번째 O라인을 targetNo로 치환 (ex: "O7000" → "O7002")
const replaceONumber = (content: string, targetNo: string): string => {
  const digits = targetNo.replace(/^O/i, '');
  const padded = digits.padStart(4, '0');
  return content.replace(/^O\d+/m, `O${padded}`);
};

// ── 기본 스토리지 경로 ────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const REPO_DIR  = PROGRAM_REPOSITORY_DIR;        // SCHEDULER_REPO
const SHARE_DIR = path.join(DATA_DIR, 'share');  // TRANSFER_SHARE
const UPLOAD_TMP_DIR = path.join(DATA_DIR, 'upload-tmp');
mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
const repoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_TMP_DIR,
    filename: (_req, _file, callback) => callback(null, `${Date.now()}-${randomUUID()}.tmp`),
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
});

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
  comment?: string;
  sha256?: string;
  originalFileName?: string;
  uploadedBy?: string;
  schedulerRegistered?: boolean;
  schedulerMismatch?: boolean;
  isRunning?: boolean;
}

function validateNcComment(comment: string): string | null {
  const hasInvalidCharacter = [...comment].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code > 0x7e;
  });
  return /[\r\n()]/.test(comment) || hasInvalidCharacter
    ? 'NC 파일 코멘트는 줄바꿈과 괄호를 제외한 ASCII 문자만 사용할 수 있습니다.'
    : null;
}

function rewriteProgramHeader(content: string, programNo: string, comment: string): string {
  const replacement = `${programNo}${comment ? `(${comment})` : ''}`;
  return content.replace(/^[ \t]*O\d{1,4}\b[ \t]*(?:\([^\r\n)]*\))?/im, replacement);
}

async function getFileSize(filePath: string): Promise<number | null> {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return null;
  }
}

async function findMachine(machineId?: string | null): Promise<{ id: string; machineId: string } | null> {
  if (!machineId || !isSafe(machineId)) return null;
  return prisma.machine.findUnique({ where: { machineId }, select: { id: true, machineId: true } });
}

async function getRepoPath1(machineId: string): Promise<string | null> {
  if (!isSafe(machineId)) return null;
  const machine = await prisma.machine.findUnique({
    where: { machineId },
    select: { programTransferConfig: true },
  });
  if (!machine) return null;
  return resolveProgramRepositoryPath1(machineId, (machine.programTransferConfig ?? {}) as Record<string, unknown>);
}

async function readDirEntries(dir: string): Promise<FileEntry[]> {
  try {
    await ensureDir(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const result: FileEntry[] = [];
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      const stat = await fs.stat(filePath);
      const programNo = entry.name.match(/^O?\d+/i)?.[0]?.toUpperCase();
      const comment = programNo && !entry.isDirectory()
        ? await readProgramComment(filePath)
        : undefined;
      result.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ...(programNo && !entry.isDirectory() ? { programNo } : {}),
        ...(comment ? { comment } : {}),
      });
    }
    return result;
  } catch {
    return [];
  }
}

async function readProgramComment(filePath: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString('utf8');
    const match = header.match(/(?:^|\r?\n)\s*O\d{1,8}\b[ \t]*\(([^)\r\n]*)\)/i);
    const comment = match?.[1]?.trim();
    return comment || undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

// ── 인증 전용 미들웨어 ─────────────────────────────────────────
router.use(authenticate);

router.get('/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId, limit } = req.query as Record<string, string>;
    const items = await listFileOperationHistory(machineId || undefined, Number(limit ?? 100));
    return res.json({ success: true, data: { items } });
  } catch (err) {
    next(err);
  }
});

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

    const machine = await findMachine((req.body as { machineId?: string }).machineId);
    await recordFileOperation({
      machineDbId: machine?.id ?? null,
      machineCode: machine?.machineId ?? null,
      operationType: 'UPLOAD_SHARE',
      target: 'TRANSFER_SHARE',
      fileName: file.originalname,
      fileNames: [file.originalname],
      status: 'SUCCESS',
      userId: req.user!.id,
      username: req.user!.username,
      fileSizeAfter: file.size,
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
// 프로그램 저장소 파일 목록
// ─────────────────────────────────────────────────────────────
router.get('/repo/:machineId/:pathKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId, pathKey } = req.params;
    if (!isSafe(machineId) || pathKey !== 'path1') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PATH', message: '잘못된 경로입니다' } });
    }
    const dir = await getRepoPath1(machineId);
    if (!dir) {
      return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    }
    const entries = await readDirEntries(dir);
    const machine = await prisma.machine.findUnique({ where: { machineId }, select: { id: true } });
    const programs = machine
      ? await prisma.programRepositoryFile.findMany({ where: { machineDbId: machine.id } })
      : [];
    const schedulerRows = machine
      ? await prisma.schedulerRow.findMany({
          where: { machineDbId: machine.id },
          select: { mainProgramNo: true, mainProgramSha256: true, status: true },
        })
      : [];
    const metadata = new Map(programs.map((program) => [program.fileName, program]));
    const schedulerByProgram = new Map<string, typeof schedulerRows>();
    for (const row of schedulerRows) {
      const references = schedulerByProgram.get(row.mainProgramNo) ?? [];
      references.push(row);
      schedulerByProgram.set(row.mainProgramNo, references);
    }
    const data = entries.map((entry) => {
      const program = metadata.get(entry.name);
      const references = program ? (schedulerByProgram.get(program.programNo) ?? []) : [];
      return program ? {
        ...entry,
        programNo: program.programNo,
        comment: program.comment,
        sha256: program.sha256,
        originalFileName: program.originalFileName,
        uploadedBy: program.uploadedBy,
        schedulerRegistered: references.length > 0,
        schedulerMismatch: references.some((row) => Boolean(row.mainProgramSha256 && row.mainProgramSha256 !== program.sha256)),
        isRunning: references.some((row) => row.status === 'RUNNING' || row.status === 'PAUSED'),
      } : entry;
    });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/repo/:machineId/path1/info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dir = await getRepoPath1(req.params.machineId);
    if (!dir) return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    return res.json({ success: true, data: { machineId: req.params.machineId, path: dir, allowedNames: ['O0001', 'O0001.nc', 'O0001.txt'] } });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/files/repo/:machineId/path1/upload
// 장비별 Path1 프로그램 저장소에 실제 파일 업로드
// ─────────────────────────────────────────────────────────────
router.post('/repo/:machineId/path1/upload', requireRole('ADMIN', 'HQ_ENGINEER'), repoUpload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  const tempPath = req.file?.path;
  try {
    const { machineId } = req.params;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '파일이 없습니다' } });
    }
    if (!isSafe(file.originalname) || !/^O?\d{1,4}(?:\.(?:nc|txt))?$/i.test(file.originalname)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_NAME', message: '파일명이 유효하지 않습니다' } });
    }
    const dir = await getRepoPath1(machineId);
    if (!dir) {
      return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    }

    const raw = await fs.readFile(file.path);
    const withoutBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf ? raw.subarray(3) : raw;
    if (withoutBom.some((byte) => byte > 0x7f)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ENCODING', message: 'NC 파일은 ASCII 호환 문자만 사용할 수 있습니다. 한글 설명은 프로그램 코멘트에 입력하세요.' } });
    }
    const content = withoutBom.toString('ascii');
    const contentProgram = content.match(/^[ \t]*O(\d{1,4})\b/im)?.[1];
    const fileProgram = file.originalname.match(/^O?(\d{1,4})/i)?.[1];
    const requestedProgram = String((req.body as { targetProgramNo?: string }).targetProgramNo ?? contentProgram ?? fileProgram ?? '');
    const normalizedProgram = normalizeProgramNo(requestedProgram);
    if (!normalizedProgram || !contentProgram) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PROGRAM', message: '파일 내부에서 유효한 O 프로그램 번호를 찾을 수 없습니다.' } });
    }
    const programNo = formatProgramNo(normalizedProgram);
    const canonicalName = `${programNo}.nc`;
    const comment = String((req.body as { comment?: string }).comment ?? '').trim().slice(0, 500);
    const commentError = validateNcComment(comment);
    if (commentError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_COMMENT', message: commentError } });
    }
    const normalizedContent = rewriteProgramHeader(content, programNo, comment);
    const normalizedBytes = Buffer.from(normalizedContent, 'ascii');
    const sha256 = createHash('sha256').update(normalizedBytes).digest('hex');
    const overwrite = String((req.body as { overwrite?: string }).overwrite ?? 'false') === 'true';
    const machine = await prisma.machine.findUnique({ where: { machineId }, select: { id: true, machineId: true } });
    if (!machine) return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    const existing = await prisma.programRepositoryFile.findUnique({
      where: { machineDbId_programNo: { machineDbId: machine.id, programNo } },
    });
    const activeReference = await prisma.schedulerRow.findFirst({
      where: { machineDbId: machine.id, mainProgramNo: programNo, status: { in: ['RUNNING', 'PAUSED'] } },
    });
    if (activeReference && (existing || overwrite)) {
      return res.status(409).json({ success: false, error: { code: 'PROGRAM_REPOSITORY_RUNNING', message: `${programNo}은 현재 실행 중이어서 교체할 수 없습니다.` } });
    }
    await ensureDir(dir);
    const existingFilesBeforeUpload = await fs.readdir(dir);
    const physicalConflict = existingFilesBeforeUpload.some((existingFile) => normalizeProgramNo(path.parse(existingFile).name) === normalizedProgram);
    if ((existing || physicalConflict) && !overwrite) {
      return res.status(409).json({ success: false, error: { code: 'PROGRAM_REPOSITORY_CONFLICT', message: `${programNo} 프로그램이 이미 존재합니다.` }, data: existing });
    }

    const filePath = path.join(dir, canonicalName);
    const beforeSize = await getFileSize(filePath);
    const stagedPath = path.join(dir, `.${canonicalName}.${randomUUID()}.tmp`);
    await fs.writeFile(stagedPath, normalizedBytes);
    for (const existingFile of existingFilesBeforeUpload) {
      const existingNo = normalizeProgramNo(path.parse(existingFile).name);
      if (existingNo === normalizedProgram && existingFile !== path.basename(stagedPath)) {
        await fs.rm(path.join(dir, existingFile), { force: true });
      }
    }
    await fs.rename(stagedPath, filePath);

    await prisma.programRepositoryFile.upsert({
      where: { machineDbId_programNo: { machineDbId: machine.id, programNo } },
      create: {
        machineDbId: machine.id,
        programNo,
        fileName: canonicalName,
        originalFileName: file.originalname,
        comment,
        fileSize: normalizedBytes.length,
        sha256,
        uploadedById: req.user!.id,
        uploadedBy: req.user!.username,
      },
      update: {
        fileName: canonicalName,
        originalFileName: file.originalname,
        comment,
        fileSize: normalizedBytes.length,
        sha256,
        uploadedById: req.user!.id,
        uploadedBy: req.user!.username,
      },
    });

    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'files.upload_repo',
      targetType: 'file',
      targetId: programNo,
      params: { machineId, pathKey: 'path1', originalFileName: file.originalname, fileName: canonicalName, size: normalizedBytes.length, overwrite },
      result: 'success',
      ipAddress: req.ip ?? 'unknown',
    });
    await recordFileOperation({
      machineDbId: machine.id,
      machineCode: machine.machineId,
      operationType: 'UPLOAD_REPO',
      target: 'SCHEDULER_REPO',
      fileName: canonicalName,
      fileNames: [canonicalName],
      path: 'path1',
      status: 'SUCCESS',
      userId: req.user!.id,
      username: req.user!.username,
      fileSizeBefore: beforeSize,
      fileSizeAfter: normalizedBytes.length,
    });

    const stat = await fs.stat(filePath);
    return res.json({ success: true, data: { name: canonicalName, isDirectory: false, size: stat.size, modifiedAt: stat.mtime.toISOString(), programNo, comment, sha256, originalFileName: file.originalname, uploadedBy: req.user!.username } });
  } catch (err) {
    next(err);
  } finally {
    if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
});

router.patch('/repo/:machineId/path1/:programNo/comment', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const machine = await prisma.machine.findUnique({ where: { machineId: req.params.machineId }, select: { id: true } });
    const normalized = normalizeProgramNo(req.params.programNo);
    if (!machine || !normalized) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '프로그램을 찾을 수 없습니다.' } });
    const programNo = formatProgramNo(normalized);
    const comment = String((req.body as { comment?: string }).comment ?? '').trim().slice(0, 500);
    const commentError = validateNcComment(comment);
    if (commentError) return res.status(400).json({ success: false, error: { code: 'INVALID_COMMENT', message: commentError } });
    const activeReference = await prisma.schedulerRow.findFirst({
      where: { machineDbId: machine.id, mainProgramNo: programNo, status: { in: ['RUNNING', 'PAUSED'] } },
    });
    if (activeReference) return res.status(409).json({ success: false, error: { code: 'PROGRAM_REPOSITORY_RUNNING', message: `${programNo}은 현재 실행 중이어서 수정할 수 없습니다.` } });
    const existing = await prisma.programRepositoryFile.findUnique({ where: { machineDbId_programNo: { machineDbId: machine.id, programNo } } });
    if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '프로그램을 찾을 수 없습니다.' } });
    const directory = await getRepoPath1(req.params.machineId);
    if (!directory) return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });
    const filePath = path.join(directory, existing.fileName);
    const content = await fs.readFile(filePath, 'ascii');
    const normalizedContent = rewriteProgramHeader(content, programNo, comment);
    const normalizedBytes = Buffer.from(normalizedContent, 'ascii');
    const sha256 = createHash('sha256').update(normalizedBytes).digest('hex');
    await fs.writeFile(filePath, normalizedBytes);
    const program = await prisma.programRepositoryFile.update({
      where: { machineDbId_programNo: { machineDbId: machine.id, programNo } },
      data: { comment, fileSize: normalizedBytes.length, sha256 },
    });
    return res.json({ success: true, data: program });
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
    const { root, machineId, pathKey, name } = req.query as Record<string, string>;
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
      if (pathKey !== 'path1') {
        return res.status(400).json({ success: false, error: { code: 'INVALID_PATH', message: 'Path1만 지원합니다' } });
      }
      const dir = await getRepoPath1(machineId);
      if (!dir) return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
      filePath = path.join(dir, name);
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
    const { root, machineId, pathKey, fileName, content } = req.body as Record<string, string>;
    if (!fileName || !isSafe(fileName)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_NAME', message: '파일명이 유효하지 않습니다' } });
    }

    let filePath: string;
    if (root === 'TRANSFER_SHARE') {
      await ensureDir(SHARE_DIR);
      filePath = path.join(SHARE_DIR, fileName);
    } else if (root === 'SCHEDULER_REPO') {
      if (req.user!.role !== 'ADMIN' && req.user!.role !== 'HQ_ENGINEER') {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '프로그램 저장소 수정 권한이 없습니다' } });
      }
      if (!machineId || !isSafe(machineId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MACHINE', message: '장비 ID가 유효하지 않습니다' } });
      }
      if (pathKey !== 'path1') {
        return res.status(400).json({ success: false, error: { code: 'INVALID_PATH', message: 'Path1만 지원합니다' } });
      }
      const dir = await getRepoPath1(machineId);
      if (!dir) return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
      await ensureDir(dir);
      filePath = path.join(dir, fileName);
    } else {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ROOT', message: '저장소 유형이 유효하지 않습니다' } });
    }

    const beforeSize = await getFileSize(filePath);
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
    const machine = await findMachine(machineId);
    await recordFileOperation({
      machineDbId: machine?.id ?? null,
      machineCode: machine?.machineId ?? null,
      operationType: root === 'TRANSFER_SHARE' ? 'EDIT_SHARE' : 'EDIT_REPO',
      target: root,
      fileName,
      fileNames: [fileName],
      status: 'SUCCESS',
      userId: req.user!.id,
      username: req.user!.username,
      fileSizeBefore: beforeSize,
      fileSizeAfter: stat.size,
    });
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
    const { root, machineId, pathKey, fileNames } = req.body as { root: string; machineId?: string; pathKey?: string; fileNames: string[] };
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
      if (req.user!.role !== 'ADMIN' && req.user!.role !== 'HQ_ENGINEER') {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '프로그램 저장소 삭제 권한이 없습니다' } });
      }
      if (!machineId || !isSafe(machineId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MACHINE', message: '장비 ID가 유효하지 않습니다' } });
      }
      if (pathKey !== 'path1') {
        return res.status(400).json({ success: false, error: { code: 'INVALID_PATH', message: 'Path1만 지원합니다' } });
      }
      const dir = await getRepoPath1(machineId);
      if (!dir) return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
      baseDir = dir;
    } else {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ROOT', message: '저장소 유형이 유효하지 않습니다' } });
    }

    if (root === 'SCHEDULER_REPO' && machineId) {
      const machine = await findMachine(machineId);
      const programNos = fileNames
        .map((name) => normalizeProgramNo(path.parse(name).name))
        .filter((value): value is string => value !== null)
        .map(formatProgramNo);
      const registeredRows = machine && programNos.length > 0
        ? await prisma.schedulerRow.findMany({
            where: { machineDbId: machine.id, mainProgramNo: { in: programNos } },
            select: { mainProgramNo: true },
          })
        : [];
      if (registeredRows.length > 0) {
        const blocked = [...new Set(registeredRows.map((row) => row.mainProgramNo))].join(', ');
        return res.status(409).json({ success: false, error: { code: 'PROGRAM_REPOSITORY_REGISTERED', message: `스케줄러에 등록된 프로그램은 삭제할 수 없습니다: ${blocked}` } });
      }
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

    if (root === 'SCHEDULER_REPO' && machineId) {
      const machine = await findMachine(machineId);
      const programNos = fileNames
        .map((name) => normalizeProgramNo(path.parse(name).name))
        .filter((value): value is string => value !== null)
        .map(formatProgramNo);
      if (machine && programNos.length > 0) {
        await prisma.programRepositoryFile.deleteMany({ where: { machineDbId: machine.id, programNo: { in: programNos } } });
      }
    }

    const machine = await findMachine(machineId);
    for (const result of results) {
      await recordFileOperation({
        machineDbId: machine?.id ?? null,
        machineCode: machine?.machineId ?? null,
        operationType: root === 'TRANSFER_SHARE' ? 'DELETE_SHARE' : 'DELETE_REPO',
        target: root,
        fileName: result.name,
        fileNames: [result.name],
        status: result.deleted ? 'SUCCESS' : 'FAILURE',
        errorMessage: result.deleted ? null : 'File delete failed',
        userId: req.user!.id,
        username: req.user!.username,
      });
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
    const {
      machineId, direction, fileNames,
      conflictPolicy = 'OVERWRITE', path: pathNo = 1,
      targetProgramNos = {} as Record<string, string>,
      forceOverwrite = false,
    } = req.body as {
      machineId: string;
      direction: 'PC_TO_CNC' | 'CNC_TO_PC';
      fileNames: string[];
      conflictPolicy: string;
      path: number;
      targetProgramNos?: Record<string, string>;
      forceOverwrite?: boolean;
    };

    if (!machineId || !isSafe(machineId)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_MACHINE', message: 'Invalid machine ID' } });
    }
    if (!Array.isArray(fileNames) || fileNames.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILES', message: 'No files selected for transfer' } });
    }

    const machine = await findMachine(machineId);
    if (!machine) {
      return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: 'Machine not found' } });
    }

    const correlationId = `xfer-${Date.now()}`;
    const jobs: Array<{ fileName: string; correlationId: string }> = [];

    if (direction === 'PC_TO_CNC') {
      for (const fileName of fileNames) {
        if (!isSafe(fileName)) continue;
        const jobCid = `${correlationId}-${fileName}`;
        const filePath = path.join(SHARE_DIR, fileName);
        let content = '';
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch {
          await recordFileOperation({
            machineDbId: machine.id,
            machineCode: machine.machineId,
            operationType: 'TRANSFER_PC_TO_CNC',
            target: 'CNC_LOCAL',
            fileName,
            fileNames: [fileName],
            path: `path${pathNo}`,
            status: 'FAILURE',
            correlationId: jobCid,
            userId: req.user!.id,
            username: req.user!.username,
            errorMessage: 'Source file not found in PC shared storage',
          });
          jobs.push({ fileName, correlationId: jobCid });
          continue;
        }

        await recordFileOperation({
          machineDbId: machine.id,
          machineCode: machine.machineId,
          operationType: 'TRANSFER_PC_TO_CNC',
          target: 'CNC_LOCAL',
          fileName,
          fileNames: [fileName],
          path: `path${pathNo}`,
          status: 'PENDING',
          correlationId: jobCid,
          userId: req.user!.id,
          username: req.user!.username,
          fileSizeBefore: Buffer.byteLength(content, 'utf-8'),
        });
        // targetProgramNo 지정 시 content의 O라인 치환
        const targetNo = targetProgramNos[fileName];
        const finalContent = targetNo ? replaceONumber(content, targetNo) : content;

        mqttService.publish(TOPICS.COMMAND_TO(machineId), {
          timestamp: new Date().toISOString(),
          command: 'UPLOAD_PROGRAM',
          correlationId: jobCid,
          params: { fileName, content: finalContent, conflictPolicy, forceOverwrite },
        });
        jobs.push({ fileName, correlationId: jobCid });
      }
    } else {
      for (const fileName of fileNames) {
        if (!isSafe(fileName)) continue;
        const jobCid = `${correlationId}-${fileName}`;
        await recordFileOperation({
          machineDbId: machine.id,
          machineCode: machine.machineId,
          operationType: 'TRANSFER_CNC_TO_PC',
          target: 'TRANSFER_SHARE',
          fileName,
          fileNames: [fileName],
          path: `path${pathNo}`,
          status: 'PENDING',
          correlationId: jobCid,
          userId: req.user!.id,
          username: req.user!.username,
        });
        mqttService.publish(TOPICS.COMMAND_TO(machineId), {
          timestamp: new Date().toISOString(),
          command: 'DOWNLOAD_PROGRAM',
          correlationId: jobCid,
          params: { fileName, conflictPolicy, path: pathNo },
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

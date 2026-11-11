import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
export const PROGRAM_REPOSITORY_DIR = process.env.PROGRAM_REPOSITORY_ROOT
  ? path.resolve(process.env.PROGRAM_REPOSITORY_ROOT)
  : process.env.DNC_ROOT
    ? path.resolve(process.env.DNC_ROOT)
  : path.join(DATA_DIR, 'program-repository');

export interface ProgramTransferManifest {
  rowId: string;
  path: 1 | 2;
  programNo: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  sha256: string;
}

export function resolveProgramRepositoryPath1(machineId: string, _config?: Record<string, unknown> | null): string {
  return path.join(PROGRAM_REPOSITORY_DIR, machineId, 'path1');
}

export function normalizeProgramNo(programNo: string): string | null {
  const match = programNo.trim().match(/^O?(\d+)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= 9999 ? String(value) : null;
}

export function formatProgramNo(programNo: string): string {
  return `O${String(Number(programNo)).padStart(4, '0')}`;
}

function programNoFromFileName(fileName: string): string | null {
  const stem = path.parse(fileName).name;
  return normalizeProgramNo(stem);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export async function buildProgramTransferManifest(
  directory: string,
  rowId: string,
  programNo: string,
  pathNo: 1 | 2 = 1,
): Promise<ProgramTransferManifest> {
  const normalizedProgramNo = normalizeProgramNo(programNo);
  if (!normalizedProgramNo) {
    throw new Error(`유효하지 않은 Path${pathNo} 프로그램 번호입니다: ${programNo}`);
  }

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Path${pathNo} 프로그램 저장소를 찾을 수 없습니다: ${directory}`);
    }
    throw error;
  }

  const matches = entries.filter((entry) =>
    entry.isFile() && programNoFromFileName(entry.name) === normalizedProgramNo
  );
  if (matches.length === 0) {
    throw new Error(`Path${pathNo} 프로그램 O${normalizedProgramNo} 파일이 없습니다.`);
  }
  if (matches.length > 1) {
    throw new Error(`Path${pathNo} 프로그램 O${normalizedProgramNo} 파일이 중복되었습니다.`);
  }

  const fileName = matches[0].name;
  const filePath = path.join(directory, fileName);
  const stat = await fs.stat(filePath);
  return {
    rowId,
    path: pathNo,
    programNo: formatProgramNo(normalizedProgramNo),
    fileName,
    filePath,
    fileSize: stat.size,
    sha256: await sha256File(filePath),
  };
}

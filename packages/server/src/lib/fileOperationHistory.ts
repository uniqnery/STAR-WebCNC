import { prisma } from './prisma';
import { wsService } from './websocket';

export type FileOperationStatus = 'PENDING' | 'SUCCESS' | 'FAILURE';

export interface FileOperationDto {
  id: string;
  machineId: string | null;
  operationType: string;
  target: string;
  fileName: string;
  fileNames: unknown;
  path: string | null;
  status: FileOperationStatus | string;
  correlationId: string | null;
  userName: string;
  errorMessage: string | null;
  fileSizeBefore: number | null;
  fileSizeAfter: number | null;
  startedAt: string;
  completedAt: string | null;
}

interface RecordFileOperationInput {
  machineDbId?: string | null;
  machineCode?: string | null;
  operationType: string;
  target: string;
  fileName: string;
  fileNames?: string[];
  path?: string | null;
  status: FileOperationStatus;
  correlationId?: string | null;
  userId: string;
  username: string;
  errorMessage?: string | null;
  fileSizeBefore?: number | null;
  fileSizeAfter?: number | null;
  completedAt?: Date | null;
}

type FileOperationRow = Awaited<ReturnType<typeof prisma.fileOperationHistory.findFirst>>;

export function toFileOperationDto(row: NonNullable<FileOperationRow>): FileOperationDto {
  return {
    id: row.id,
    machineId: row.machineCode,
    operationType: row.operationType,
    target: row.target,
    fileName: row.fileName,
    fileNames: row.fileNames,
    path: row.path,
    status: row.status,
    correlationId: row.correlationId,
    userName: row.username,
    errorMessage: row.errorMessage,
    fileSizeBefore: row.fileSizeBefore,
    fileSizeAfter: row.fileSizeAfter,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function broadcastFileOperation(row: NonNullable<FileOperationRow>): void {
  const item = toFileOperationDto(row);
  const message = {
    type: 'file_operation_history',
    timestamp: new Date().toISOString(),
    payload: { machineId: item.machineId, item },
  };

  if (item.machineId) {
    wsService.broadcastToMachine(item.machineId, message);
    return;
  }

  wsService.broadcast(message);
}

export async function recordFileOperation(input: RecordFileOperationInput): Promise<FileOperationDto> {
  const row = await prisma.fileOperationHistory.create({
    data: {
      machineDbId: input.machineDbId ?? null,
      machineCode: input.machineCode ?? null,
      operationType: input.operationType,
      target: input.target,
      fileName: input.fileName,
      fileNames: input.fileNames ?? [input.fileName],
      path: input.path ?? null,
      status: input.status,
      correlationId: input.correlationId ?? null,
      userId: input.userId,
      username: input.username,
      errorMessage: input.errorMessage ?? null,
      fileSizeBefore: input.fileSizeBefore ?? null,
      fileSizeAfter: input.fileSizeAfter ?? null,
      completedAt: input.completedAt ?? (input.status === 'PENDING' ? null : new Date()),
    },
  });
  broadcastFileOperation(row);
  return toFileOperationDto(row);
}

export async function updateFileOperationByCorrelation(
  correlationId: string,
  status: FileOperationStatus,
  errorMessage?: string | null,
): Promise<FileOperationDto[]> {
  const rows = await prisma.fileOperationHistory.findMany({ where: { correlationId } });
  const updated: FileOperationDto[] = [];
  for (const row of rows) {
    const next = await prisma.fileOperationHistory.update({
      where: { id: row.id },
      data: {
        status,
        errorMessage: status === 'FAILURE' ? errorMessage ?? 'File operation failed' : null,
        completedAt: new Date(),
      },
    });
    broadcastFileOperation(next);
    updated.push(toFileOperationDto(next));
  }
  return updated;
}

export async function listFileOperationHistory(machineCode?: string, limit = 100): Promise<FileOperationDto[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const rows = await prisma.fileOperationHistory.findMany({
    where: machineCode ? { OR: [{ machineCode }, { machineCode: null }] } : undefined,
    orderBy: { startedAt: 'desc' },
    take: safeLimit,
  });
  return rows.map(toFileOperationDto);
}
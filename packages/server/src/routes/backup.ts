// Backup Routes - CNC Data Backup

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { mqttService, TOPICS } from '../lib/mqtt';
import { authenticate, requireRole } from '../middleware/auth';
import { createAuditLog } from './audit';

const router = Router();

// Backup types
type BackupType = 'SRAM' | 'PARAMETER' | 'PROGRAM' | 'FULL';

interface BackupRecord {
  id: string;
  machineId: string;
  type: BackupType;
  fileName: string;
  fileSize: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  createdAt: Date;
  completedAt?: Date;
  errorMessage?: string;
  filePath?: string;
}

// In-memory backup records (in production, use database)
const backupRecords = new Map<string, BackupRecord>();

// Get backup history for a machine
router.get('/:machineId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    // Find machine
    const machine = await prisma.machine.findUnique({
      where: { machineId },
    });

    if (!machine) {
      return res.status(404).json({
        success: false,
        error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' },
      });
    }

    // Get backups from map (filter by machineId)
    const allBackups = Array.from(backupRecords.values())
      .filter((b) => b.machineId === machineId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = allBackups.length;
    const backups = allBackups.slice((page - 1) * limit, page * limit);

    res.json({
      success: true,
      data: {
        items: backups,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Create new backup
router.post('/:machineId', authenticate, requireRole(['ADMIN', 'AS']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId } = req.params;
    const { type } = req.body as { type: BackupType };

    if (!type || !['SRAM', 'PARAMETER', 'PROGRAM', 'FULL'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TYPE', message: '유효하지 않은 백업 유형입니다' },
      });
    }

    // Find machine
    const machine = await prisma.machine.findUnique({
      where: { machineId },
    });

    if (!machine) {
      return res.status(404).json({
        success: false,
        error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' },
      });
    }

    const backupId = `backup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date();
    const fileName = `${machineId}_${type}_${timestamp.toISOString().replace(/[:.]/g, '-')}.zip`;

    // Create backup record
    const backupRecord: BackupRecord = {
      id: backupId,
      machineId,
      type,
      fileName,
      fileSize: 0,
      status: 'PENDING',
      createdAt: timestamp,
    };
    backupRecords.set(backupId, backupRecord);

    // Send backup command to Agent via MQTT
    mqttService.publish(TOPICS.SERVER_COMMAND(machineId), {
      command: 'CREATE_BACKUP',
      correlationId: backupId,
      params: {
        type,
        backupId,
        fileName,
      },
    });

    // Log command
    await prisma.commandLog.create({
      data: {
        correlationId: backupId,
        machineId: machine.id,
        command: 'CREATE_BACKUP',
        params: { type, fileName },
        status: 'PENDING',
      },
    });

    // Audit log
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'backup.create',
      targetType: 'machine',
      targetId: machineId,
      params: { type, backupId },
      result: 'success',
      ipAddress: req.ip || 'unknown',
    });

    res.json({
      success: true,
      data: backupRecord,
    });
  } catch (error) {
    next(error);
  }
});

// Get backup status
router.get('/status/:backupId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { backupId } = req.params;

    const backup = backupRecords.get(backupId);
    if (!backup) {
      return res.status(404).json({
        success: false,
        error: { code: 'BACKUP_NOT_FOUND', message: '백업을 찾을 수 없습니다' },
      });
    }

    res.json({
      success: true,
      data: backup,
    });
  } catch (error) {
    next(error);
  }
});

// Download backup file
router.get('/download/:backupId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { backupId } = req.params;

    const backup = backupRecords.get(backupId);
    if (!backup) {
      return res.status(404).json({
        success: false,
        error: { code: 'BACKUP_NOT_FOUND', message: '백업을 찾을 수 없습니다' },
      });
    }

    if (backup.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: { code: 'BACKUP_NOT_READY', message: '백업이 아직 완료되지 않았습니다' },
      });
    }

    // In production, read file from backup.filePath and stream it
    // For now, return mock data
    const mockData = Buffer.from(`Mock backup data for ${backup.fileName}`);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.fileName}"`);
    res.setHeader('Content-Length', mockData.length);
    res.send(mockData);
  } catch (error) {
    next(error);
  }
});

// Update backup status (called by agent via internal API)
export function updateBackupStatus(
  backupId: string,
  status: BackupRecord['status'],
  details?: { fileSize?: number; filePath?: string; errorMessage?: string }
): void {
  const backup = backupRecords.get(backupId);
  if (backup) {
    backup.status = status;
    if (status === 'COMPLETED') {
      backup.completedAt = new Date();
    }
    if (details) {
      if (details.fileSize) backup.fileSize = details.fileSize;
      if (details.filePath) backup.filePath = details.filePath;
      if (details.errorMessage) backup.errorMessage = details.errorMessage;
    }
  }
}

export default router;

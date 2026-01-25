// Transfer Routes - Program Upload/Download

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { mqttService, TOPICS } from '../lib/mqtt';
import { authenticate } from '../middleware/auth';
import { createAuditLog } from './audit';

const router = Router();

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept NC program files
    const allowedExtensions = ['.nc', '.txt', '.prg', '.cnc'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowedExtensions.includes(ext) || !ext.includes('.')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

// List programs on CNC
router.get('/:machineId/programs', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId } = req.params;

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

    // Request program list from Agent via MQTT
    const correlationId = `prog-list-${Date.now()}`;

    mqttService.publish(TOPICS.SERVER_COMMAND(machineId), {
      command: 'LIST_PROGRAMS',
      correlationId,
      params: {},
    });

    // In a real implementation, wait for agent response via MQTT/Redis
    // For now, return a mock response
    res.json({
      success: true,
      data: {
        programs: [
          { programNo: 'O0001', name: 'MAIN PROG 1', size: 1024, modified: new Date().toISOString() },
          { programNo: 'O0002', name: 'SUB PROG 1', size: 512, modified: new Date().toISOString() },
          { programNo: 'O1000', name: 'TEST PROG', size: 2048, modified: new Date().toISOString() },
        ],
        machineId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Upload program to CNC (Server → CNC)
router.post('/:machineId/upload', authenticate, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId } = req.params;
    const { programNo } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: '파일이 업로드되지 않았습니다' },
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

    const correlationId = `upload-${Date.now()}`;
    const content = file.buffer.toString('utf-8');
    const targetProgramNo = programNo || extractProgramNo(file.originalname, content);

    // Send upload command to Agent via MQTT
    mqttService.publish(TOPICS.SERVER_COMMAND(machineId), {
      command: 'UPLOAD_PROGRAM',
      correlationId,
      params: {
        programNo: targetProgramNo,
        content,
        fileName: file.originalname,
      },
    });

    // Log command
    await prisma.commandLog.create({
      data: {
        correlationId,
        machineId: machine.id,
        command: 'UPLOAD_PROGRAM',
        params: { programNo: targetProgramNo, fileName: file.originalname },
        status: 'PENDING',
      },
    });

    // Audit log
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'transfer.upload',
      targetType: 'machine',
      targetId: machineId,
      params: { programNo: targetProgramNo, fileName: file.originalname },
      result: 'success',
      ipAddress: req.ip || 'unknown',
    });

    res.json({
      success: true,
      data: {
        correlationId,
        machineId,
        programNo: targetProgramNo,
        fileName: file.originalname,
        size: file.size,
        status: 'PENDING',
      },
    });
  } catch (error) {
    next(error);
  }
});

// Download program from CNC (CNC → Server)
router.get('/:machineId/download/:programNo', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId, programNo } = req.params;

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

    const correlationId = `download-${Date.now()}`;

    // Send download command to Agent via MQTT
    mqttService.publish(TOPICS.SERVER_COMMAND(machineId), {
      command: 'DOWNLOAD_PROGRAM',
      correlationId,
      params: { programNo },
    });

    // Log command
    await prisma.commandLog.create({
      data: {
        correlationId,
        machineId: machine.id,
        command: 'DOWNLOAD_PROGRAM',
        params: { programNo },
        status: 'PENDING',
      },
    });

    // Audit log
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'transfer.download',
      targetType: 'machine',
      targetId: machineId,
      params: { programNo },
      result: 'success',
      ipAddress: req.ip || 'unknown',
    });

    // In real implementation, wait for agent response
    res.json({
      success: true,
      data: {
        correlationId,
        machineId,
        programNo,
        status: 'PENDING',
      },
    });
  } catch (error) {
    next(error);
  }
});

// Helper to extract program number from filename or content
function extractProgramNo(filename: string, content: string): string {
  // Try to extract from filename (e.g., "O0001.nc" -> "O0001")
  const filenameMatch = filename.match(/^O?\d+/i);
  if (filenameMatch) {
    const num = filenameMatch[0].toUpperCase();
    return num.startsWith('O') ? num : `O${num}`;
  }

  // Try to extract from content (e.g., first line "O0001" or "%O0001")
  const contentMatch = content.match(/^[%]?O?\d+/m);
  if (contentMatch) {
    const num = contentMatch[0].replace('%', '').toUpperCase();
    return num.startsWith('O') ? num : `O${num}`;
  }

  // Default
  return `O${Date.now() % 10000}`;
}

export default router;

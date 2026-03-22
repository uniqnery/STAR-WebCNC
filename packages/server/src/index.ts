import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import path from 'path';

// Config & Routes
import { config } from './config';
import authRoutes from './routes/auth';
import machineRoutes from './routes/machines';
import commandRoutes from './routes/commands';
import schedulerRoutes, { handleM20Event } from './routes/scheduler';
import alarmRoutes, { storeAlarm } from './routes/alarms';
import transferRoutes from './routes/transfer';
import backupRoutes from './routes/backup';
import productionRoutes from './routes/production';
import workOrderRoutes from './routes/workOrder';
import auditRoutes from './routes/audit';
import templateRoutes from './routes/templates';
import fileRoutes from './routes/files';
import diagnosticsRoutes from './routes/diagnostics';
import settingsRoutes from './routes/settings';
import { errorHandler } from './middleware/error';

// Services
import { wsService } from './lib/websocket';
import { mqttService, TOPICS, TelemetryMessage, AlarmMessage, EventMessage, CommandResultMessage, PmcBitsMessage } from './lib/mqtt';
import { redisService, REDIS_KEYS } from './lib/redis';
import { commandWaiter } from './lib/commandWaiter';
import { prisma } from './lib/prisma';
import { syncTemplatesFromFiles } from './lib/templateSync';

// Express App
const app = express();

// Middleware
app.use(cors({
  origin: config.nodeEnv === 'production'
    ? config.corsOrigin
    : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Health Check
app.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    services: {
      mqtt: mqttService.isConnected,
      redis: redisService.isConnected,
      websocket: wsService.clientCount,
    },
  });
});

// API Routes
app.get('/api', (req, res) => {
  res.json({
    message: 'Star-WebCNC API Server',
    version: '0.1.0'
  });
});

// Auth Routes
app.use('/api/auth', authRoutes);

// Machine Routes
app.use('/api/machines', machineRoutes);

// Command Routes
app.use('/api/commands', commandRoutes);

// Scheduler Routes
app.use('/api/scheduler', schedulerRoutes);

// Alarm Routes
app.use('/api/alarms', alarmRoutes);

// Transfer Routes
app.use('/api/transfer', transferRoutes);

// Backup Routes
app.use('/api/backup', backupRoutes);

// Production Routes (POP)
app.use('/api/production', productionRoutes);

// Work Order Routes (MES)
app.use('/api/work-orders', workOrderRoutes);

// Audit Routes
app.use('/api/audit', auditRoutes);

// Template Routes
app.use('/api/templates', templateRoutes);

// File Management Routes (DNC 저장소 / 공유 폴더)
app.use('/api/files', fileRoutes);

// Diagnostics Routes (시스템 상태 점검)
app.use('/api/diagnostics', diagnosticsRoutes);

// Settings Routes (전역 설정)
app.use('/api/settings', settingsRoutes);

// Error Handler (must be last middleware)
app.use(errorHandler);

// HTTP Server
const httpServer = createServer(app);

// Initialize services
async function initializeServices(): Promise<void> {
  try {
    // Connect to Redis
    console.log('[Server] Connecting to Redis...');
    await redisService.connect();

    // Connect to MQTT
    console.log('[Server] Connecting to MQTT...');
    await mqttService.connect();

    // Setup MQTT message handlers
    setupMqttHandlers();

    // Initialize WebSocket
    console.log('[Server] Initializing WebSocket...');
    wsService.initialize(httpServer);

    // Sync templates from files → DB (파일이 원본)
    await syncTemplatesFromFiles();

    console.log('[Server] All services initialized');
  } catch (err) {
    console.error('[Server] Failed to initialize services:', err);
    // Continue running even if some services fail
    // This allows local development without all infrastructure
  }
}

// Setup MQTT message handlers
function setupMqttHandlers(): void {
  // Handle telemetry data from agents
  mqttService.on<TelemetryMessage>(TOPICS.AGENT_TELEMETRY, async (_topic, message) => {
    const { machineId, data } = message;

    // Cache in Redis
    await redisService.set(
      REDIS_KEYS.MACHINE_TELEMETRY(machineId),
      data,
      60 // 60 seconds TTL
    );

    // Forward to WebSocket clients
    wsService.sendTelemetry(machineId, data);
  });

  // Handle fast PMC bits update from agents (100ms 주기 — 램프 응답속도)
  mqttService.on<PmcBitsMessage>(TOPICS.AGENT_PMC_BITS, (_topic, message) => {
    const { machineId, pmcBits } = message;
    if (!machineId || !pmcBits) return;
    wsService.sendPmcBits(machineId, pmcBits);
  });

  // Handle alarms from agents
  mqttService.on<AlarmMessage>(TOPICS.AGENT_ALARM, async (_topic, message) => {
    const { machineId, alarmNo, alarmMsg, type, category, alarmTypeCode } = message;

    // Forward to WebSocket clients
    wsService.sendAlarm(machineId, { alarmNo, alarmMsg, type, category, alarmTypeCode });

    // Store alarm in database
    await storeAlarm({
      machineId,
      alarmNo,
      alarmMsg,
      type: type === 'occurred' ? 'occur' : 'clear',
    });

    // Publish to Redis for other server instances
    await redisService.publish(REDIS_KEYS.CHANNEL_ALARM, message);
  });

  // Handle command results from agents
  mqttService.on<CommandResultMessage>(TOPICS.AGENT_COMMAND_RESULT, async (_topic, message) => {
    const { machineId, correlationId, status, result, errorCode, errorMessage } = message;
    if (!machineId || !correlationId) return;

    // ── 1. DB CommandLog 상태 업데이트 ───────────────────────────
    try {
      await prisma.commandLog.updateMany({
        where: { correlationId, status: { in: ['PENDING', 'RECEIVED'] } },
        data: {
          status: status === 'success' ? 'SUCCESS' : 'FAILURE',
          result: (result as object) ?? null,
          errorCode: errorCode ?? null,
          completedAt: new Date(),
        },
      });
    } catch {
      // DB 미연결 환경에서도 계속 진행
    }

    // ── 2. wait=true 요청 대기 중인 HTTP 핸들러에 알림 ───────────
    commandWaiter.notify(correlationId, { status, result, errorCode, errorMessage });

    // ── 3. DOWNLOAD_PROGRAM 결과: share/ 폴더에 파일 저장 ────────
    if (status === 'success' && result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (r['content'] && r['fileName']) {
        const fileName = r['fileName'] as string;
        const content  = r['content'] as string;
        const shareDir = process.env.DATA_DIR
          ? path.join(process.env.DATA_DIR, 'share')
          : path.join(process.cwd(), 'data', 'share');
        try {
          await fs.mkdir(shareDir, { recursive: true });
          await fs.writeFile(path.join(shareDir, fileName), content, 'utf-8');
          console.log(`[Files] Saved downloaded program: ${fileName}`);
          wsService.broadcast({
            type: 'file_downloaded',
            timestamp: new Date().toISOString(),
            payload: { machineId, fileName },
          });
        } catch (err) {
          console.error('[Files] Failed to save downloaded program:', err);
        }
      }
    }

    // ── 4. CREATE_BACKUP 완료 시 WS broadcast ────────────────────
    if (correlationId?.startsWith('backup-') && status === 'success' && result) {
      const r = result as Record<string, unknown>;
      wsService.broadcast({
        type: 'backup_completed',
        timestamp: new Date().toISOString(),
        payload: {
          machineId,
          backupId:     correlationId,
          fileName:     r['fileName'],
          fileSize:     r['fileSize'],
          programCount: r['programCount'],
          editMode:     r['editMode'],
        },
      });
    }

    // ── 5. 모든 WebSocket 클라이언트에 결과 브로드캐스트 ─────────
    wsService.broadcast({
      type: 'command_result',
      timestamp: new Date().toISOString(),
      payload: { machineId, correlationId, status, result, errorCode, errorMessage },
    });
  });

  // Handle M20 events from agents
  mqttService.on<EventMessage>(TOPICS.AGENT_EVENT, async (_topic, message) => {
    if (message.eventType === 'M20_COMPLETE') {
      const { machineId, programNo, data } = message;

      // Forward to WebSocket clients
      wsService.sendM20Event(machineId, {
        programNo: programNo || '',
        count: (data?.count as number) || 0,
      });

      // Handle scheduler job count update
      await handleM20Event(machineId, programNo || '');

      // Publish to Redis for scheduler processing
      await redisService.publish(REDIS_KEYS.CHANNEL_EVENT, message);
    }

    if (message.eventType === 'M20_SUB_COMPLETE') {
      const { machineId, programNo, data } = message;

      // Forward to WebSocket so frontend can track sub-spindle completion
      wsService.broadcastToMachine(machineId, {
        type: 'M20_SUB_COMPLETE',
        timestamp: new Date().toISOString(),
        payload: { machineId, programNo: programNo || '', count: (data?.count as number) || 0 },
      });

      // Publish to Redis (scheduler may use this for last-piece sub-spindle sequence)
      await redisService.publish(REDIS_KEYS.CHANNEL_EVENT, message);
    }
  });

  console.log('[Server] MQTT handlers configured');
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('\n[Server] Shutting down...');

  wsService.shutdown();
  await mqttService.disconnect();
  await redisService.disconnect();

  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start Server
httpServer.listen(config.port, async () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║           Star-WebCNC Server Started                  ║
╠═══════════════════════════════════════════════════════╣
║  Environment: ${config.nodeEnv.padEnd(39)}║
║  Port:        ${String(config.port).padEnd(39)}║
║  Time:        ${new Date().toISOString().padEnd(39)}║
╚═══════════════════════════════════════════════════════╝
  `);

  // Initialize services after server starts
  await initializeServices();
});

export { app, httpServer };

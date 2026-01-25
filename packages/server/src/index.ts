import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';

// Config & Routes
import { config } from './config';
import authRoutes from './routes/auth';
import machineRoutes from './routes/machines';
import commandRoutes from './routes/commands';
import schedulerRoutes, { handleM20Event } from './routes/scheduler';
import alarmRoutes, { storeAlarm } from './routes/alarms';
import { errorHandler } from './middleware/error';

// Services
import { wsService } from './lib/websocket';
import { mqttService, TOPICS, TelemetryMessage, AlarmMessage, EventMessage } from './lib/mqtt';
import { redisService, REDIS_KEYS } from './lib/redis';

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
  mqttService.on<TelemetryMessage>(TOPICS.AGENT_TELEMETRY, async (topic, message) => {
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

  // Handle alarms from agents
  mqttService.on<AlarmMessage>(TOPICS.AGENT_ALARM, async (topic, message) => {
    const { machineId, alarmNo, alarmMsg, type } = message;

    // Forward to WebSocket clients
    wsService.sendAlarm(machineId, { alarmNo, alarmMsg, type });

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

  // Handle M20 events from agents
  mqttService.on<EventMessage>(TOPICS.AGENT_EVENT, async (topic, message) => {
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

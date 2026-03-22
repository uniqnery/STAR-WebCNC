// Diagnostics Route
// Full system health check: DB, Redis, MQTT, Agent connectivity

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { mqttService } from '../lib/mqtt';
import { redisService, REDIS_KEYS } from '../lib/redis';
import { wsService } from '../lib/websocket';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ApiResponse } from '../types';
import { UserRole } from '@prisma/client';

const router = Router();

router.use(authenticate);

interface ServiceStatus {
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

interface AgentStatus {
  machineId: string;
  machineName: string;
  online: boolean;
  lastSeenMs?: number;   // ms since last telemetry
  ipAddress: string;
}

interface DiagnosticsResult {
  timestamp: string;
  services: {
    database: ServiceStatus;
    redis: ServiceStatus;
    mqtt: ServiceStatus;
    websocket: { clientCount: number };
  };
  agents: AgentStatus[];
}

/**
 * GET /api/diagnostics
 * 전체 시스템 연결 상태 점검
 */
router.get('/',
  authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER),
  asyncHandler(async (_req: Request, res: Response<ApiResponse>) => {

    // ── 1. Database ───────────────────────────────────────────
    let dbStatus: ServiceStatus = { connected: false };
    try {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = { connected: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      dbStatus = { connected: false, error: String(err) };
    }

    // ── 2. Redis ──────────────────────────────────────────────
    const redisStatus: ServiceStatus = {
      connected: redisService.isConnected,
    };

    // ── 3. MQTT ───────────────────────────────────────────────
    const mqttStatus: ServiceStatus = {
      connected: mqttService.isConnected,
    };

    // ── 4. Agents (Redis 캐시 기반 최신성 확인) ───────────────
    const agents: AgentStatus[] = [];
    try {
      const machines = await prisma.machine.findMany({
        select: { id: true, machineId: true, name: true, ipAddress: true },
      });

      for (const m of machines) {
        let online = false;
        let lastSeenMs: number | undefined;

        if (redisService.isConnected) {
          const telemetry = await redisService.get<{ _ts?: string }>(
            REDIS_KEYS.MACHINE_TELEMETRY(m.machineId)
          );
          if (telemetry) {
            // Redis TTL=60s → 키가 존재하면 60초 이내에 수신
            online = true;
            // _ts 필드가 있으면 정확한 경과시간 계산
            if (telemetry._ts) {
              lastSeenMs = Date.now() - new Date(telemetry._ts).getTime();
            }
          }
        }

        agents.push({
          machineId: m.machineId,
          machineName: m.name,
          online,
          lastSeenMs,
          ipAddress: m.ipAddress,
        });
      }
    } catch {
      // DB 미연결 시 agents 빈 배열
    }

    const result: DiagnosticsResult = {
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus,
        mqtt: mqttStatus,
        websocket: { clientCount: wsService.clientCount },
      },
      agents,
    };

    return res.json({ success: true, data: result });
  })
);

export default router;

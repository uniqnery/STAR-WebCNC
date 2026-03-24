// Scheduler Routes — SchedulerRow 기반 API
// Agent가 count authority를 보유하고 Server는 보고값을 동기화한다.

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { mqttService, TOPICS } from '../lib/mqtt';
import { redisService, REDIS_KEYS } from '../lib/redis';
import { wsService } from '../lib/websocket';

const router = Router();
router.use(authenticate);

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function rowToDto(row: {
  id: string;
  machineDbId: string;
  order: number;
  mainProgramNo: string;
  subProgramNo: string | null;
  preset: number;
  count: number;
  status: string;
  lastError: string | null;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  createdBy: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}, machineId: string) {
  return {
    id: row.id,
    machineId,
    order: row.order,
    mainProgramNo: row.mainProgramNo,
    subProgramNo: row.subProgramNo ?? undefined,
    preset: row.preset,
    count: row.count,
    status: row.status,
    lastError: row.lastError ?? undefined,
    lastErrorCode: row.lastErrorCode ?? undefined,
    lastErrorAt: row.lastErrorAt?.toISOString(),
    createdBy: row.createdBy,
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getMachineByMachineId(machineId: string) {
  return prisma.machine.findUnique({ where: { machineId } });
}

async function syncRedisRows(machineId: string) {
  const machine = await getMachineByMachineId(machineId);
  if (!machine) return;
  const rows = await prisma.schedulerRow.findMany({
    where: { machineDbId: machine.id },
    orderBy: { order: 'asc' },
  });
  await redisService.set(REDIS_KEYS.SCHEDULER_ROWS(machineId), rows.map(r => rowToDto(r, machineId)));
}

// ─── GET /rows?machineId= ────────────────────────────────────────────────────

router.get('/rows', async (req: Request, res: Response) => {
  try {
    const { machineId } = req.query as { machineId?: string };
    if (!machineId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'machineId required' } });
    }

    const machine = await getMachineByMachineId(machineId);
    if (!machine) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    }

    const rows = await prisma.schedulerRow.findMany({
      where: { machineDbId: machine.id },
      orderBy: { order: 'asc' },
    });

    const state = await redisService.get<string>(REDIS_KEYS.SCHEDULER_STATE(machineId)) ?? 'IDLE';

    res.json({
      success: true,
      data: {
        rows: rows.map(r => rowToDto(r, machineId)),
        state,
      },
    });
  } catch (err) {
    console.error('[Scheduler] GET rows error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '목록 조회 실패' } });
  }
});

// ─── POST /rows ──────────────────────────────────────────────────────────────

router.post('/rows', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const { machineId, mainProgramNo, subProgramNo, preset } = req.body as {
      machineId: string;
      mainProgramNo: string;
      subProgramNo?: string;
      preset: number;
    };

    if (!machineId || !preset) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '필수 항목 누락' } });
    }

    const machine = await getMachineByMachineId(machineId);
    if (!machine) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    }

    // 큐 크기 확인 (template schedulerConfig.maxQueueSize)
    const count = await prisma.schedulerRow.count({ where: { machineDbId: machine.id, status: { in: ['PENDING', 'RUNNING'] } } });
    const template = machine.templateId ? await prisma.template.findUnique({ where: { id: machine.templateId } }) : null;
    const maxQueueSize = (template?.schedulerConfig as Record<string, unknown> | null)?.maxQueueSize as number ?? 15;
    if (count >= maxQueueSize) {
      return res.status(409).json({ success: false, error: { code: 'QUEUE_FULL', message: `큐가 가득 찼습니다 (최대 ${maxQueueSize}개)` } });
    }

    // 다음 순서
    const lastRow = await prisma.schedulerRow.findFirst({
      where: { machineDbId: machine.id },
      orderBy: { order: 'desc' },
    });
    const order = (lastRow?.order ?? 0) + 1;

    const row = await prisma.schedulerRow.create({
      data: {
        machineDbId: machine.id,
        order,
        mainProgramNo,
        subProgramNo: subProgramNo || null,
        preset,
        count: 0,
        status: 'PENDING',
        createdBy: req.user!.username,
      },
    });

    await syncRedisRows(machineId);
    wsService.sendSchedulerUpdate(machineId, (await prisma.schedulerRow.findMany({
      where: { machineDbId: machine.id },
      orderBy: { order: 'asc' },
    })).map(r => rowToDto(r, machineId)));

    res.status(201).json({ success: true, data: rowToDto(row, machineId) });
  } catch (err) {
    console.error('[Scheduler] POST rows error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '행 추가 실패' } });
  }
});

// ─── PUT /rows/:id ───────────────────────────────────────────────────────────

router.put('/rows/:id', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const row = await prisma.schedulerRow.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });
    if (!row) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '행을 찾을 수 없습니다' } });
    }

    // RUNNING은 수정 불가
    if (row.status === 'RUNNING') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '실행 중인 행은 수정할 수 없습니다' } });
    }

    const { mainProgramNo, subProgramNo, preset, count } = req.body as {
      mainProgramNo?: string;
      subProgramNo?: string | null;
      preset?: number;
      count?: number;
    };

    const updated = await prisma.schedulerRow.update({
      where: { id: row.id },
      data: {
        mainProgramNo: mainProgramNo ?? row.mainProgramNo,
        subProgramNo: subProgramNo !== undefined ? (subProgramNo || null) : row.subProgramNo,
        preset: preset ?? row.preset,
        count: count !== undefined ? count : row.count,
      },
    });

    const machineId = row.machine.machineId;
    await syncRedisRows(machineId);

    const allRows = await prisma.schedulerRow.findMany({
      where: { machineDbId: row.machineDbId },
      orderBy: { order: 'asc' },
    });
    wsService.sendSchedulerUpdate(machineId, allRows.map(r => rowToDto(r, machineId)));

    res.json({ success: true, data: rowToDto(updated, machineId) });
  } catch (err) {
    console.error('[Scheduler] PUT rows error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '행 수정 실패' } });
  }
});

// ─── DELETE /rows/:id ────────────────────────────────────────────────────────

router.delete('/rows/:id', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const row = await prisma.schedulerRow.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });
    if (!row) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '행을 찾을 수 없습니다' } });
    }

    if (row.status === 'RUNNING') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '실행 중인 행은 삭제할 수 없습니다' } });
    }

    await prisma.schedulerRow.delete({ where: { id: row.id } });

    const machineId = row.machine.machineId;
    await syncRedisRows(machineId);

    const allRows = await prisma.schedulerRow.findMany({
      where: { machineDbId: row.machineDbId },
      orderBy: { order: 'asc' },
    });
    wsService.sendSchedulerUpdate(machineId, allRows.map(r => rowToDto(r, machineId)));

    res.json({ success: true });
  } catch (err) {
    console.error('[Scheduler] DELETE rows error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '행 삭제 실패' } });
  }
});

// ─── POST /rows/reorder ──────────────────────────────────────────────────────

router.post('/rows/reorder', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const { machineId, orderedIds } = req.body as { machineId: string; orderedIds: string[] };
    if (!machineId || !Array.isArray(orderedIds)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '필수 항목 누락' } });
    }

    // RUNNING 행이 있으면 순서 변경 불가
    const runningRow = await prisma.schedulerRow.findFirst({
      where: { id: { in: orderedIds }, status: 'RUNNING' },
    });
    if (runningRow) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '실행 중인 행이 있으면 순서 변경할 수 없습니다' } });
    }

    // 순서 일괄 업데이트
    await Promise.all(
      orderedIds.map((id, index) =>
        prisma.schedulerRow.update({ where: { id }, data: { order: index + 1 } })
      )
    );

    await syncRedisRows(machineId);
    const machine = await getMachineByMachineId(machineId);
    if (machine) {
      const allRows = await prisma.schedulerRow.findMany({
        where: { machineDbId: machine.id },
        orderBy: { order: 'asc' },
      });
      wsService.sendSchedulerUpdate(machineId, allRows.map(r => rowToDto(r, machineId)));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Scheduler] reorder error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '순서 변경 실패' } });
  }
});

// ─── POST /start?machineId= ──────────────────────────────────────────────────

router.post('/start', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const { machineId } = req.query as { machineId?: string };
    if (!machineId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'machineId required' } });
    }

    const machine = await getMachineByMachineId(machineId);
    if (!machine) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    }

    const state = await redisService.get<string>(REDIS_KEYS.SCHEDULER_STATE(machineId)) ?? 'IDLE';
    if (state !== 'IDLE') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: `현재 상태(${state})에서는 시작할 수 없습니다` } });
    }

    // PAUSED/CANCELLED 행은 PENDING으로 초기화 + 에러 정보 클리어
    await prisma.schedulerRow.updateMany({
      where: { machineDbId: machine.id, status: { in: ['PAUSED', 'CANCELLED'] } },
      data: { status: 'PENDING', lastError: null, lastErrorCode: null, lastErrorAt: null },
    });

    // PENDING 행 존재 확인
    const pendingRows = await prisma.schedulerRow.findMany({
      where: { machineDbId: machine.id, status: 'PENDING' },
      orderBy: { order: 'asc' },
    });
    if (pendingRows.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'NO_PENDING_ROWS', message: '실행할 행이 없습니다' } });
    }

    // Control Lock 확인
    const lock = await redisService.getControlLock(machineId);
    if (!lock || lock.ownerId !== req.user!.id) {
      return res.status(403).json({ success: false, error: { code: 'NO_CONTROL_LOCK', message: '제어권이 없습니다' } });
    }

    // 전체 큐 동기화 후 MQTT START 명령
    const allRows = await prisma.schedulerRow.findMany({
      where: { machineDbId: machine.id },
      orderBy: { order: 'asc' },
    });
    const rowDtos = allRows.map(r => rowToDto(r, machineId));

    // DNC 설정 — START payload에 포함 (Agent가 API 조회 없이 사용)
    const dncCfg = (machine.dncConfig ?? {}) as Record<string, unknown>;
    // 하위호환: 구버전 executionMode → mainMode fallback
    const mainMode = (dncCfg.mainMode as string) ?? (dncCfg.executionMode as string) ?? 'memory';
    const subMode  = (dncCfg.subMode  as string) ?? 'memory';
    const dncPaths = {
      path1: (dncCfg.path1 as string) ?? '',
      path2: (dncCfg.path2 as string) ?? '',
      ...(dncCfg.path3 !== undefined && { path3: dncCfg.path3 as string }),
    };

    await redisService.set(REDIS_KEYS.SCHEDULER_ROWS(machineId), rowDtos);
    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'RUNNING', 86400);

    await mqttService.publish(TOPICS.SERVER_SCHEDULER(machineId), {
      timestamp: new Date().toISOString(),
      type: 'START',
      rows: rowDtos,
      mainMode,
      subMode,
      dncPaths,
    });

    wsService.sendSchedulerState(machineId, 'RUNNING');

    res.json({ success: true });
  } catch (err) {
    console.error('[Scheduler] start error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '시작 실패' } });
  }
});

// ─── POST /resume?machineId= ─────────────────────────────────────────────────

router.post('/resume', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const { machineId } = req.query as { machineId?: string };
    if (!machineId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'machineId required' } });
    }

    const state = await redisService.get<string>(REDIS_KEYS.SCHEDULER_STATE(machineId)) ?? 'IDLE';
    if (state !== 'PAUSED') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: `현재 상태(${state})에서는 재개할 수 없습니다` } });
    }

    const lock = await redisService.getControlLock(machineId);
    if (!lock || lock.ownerId !== req.user!.id) {
      return res.status(403).json({ success: false, error: { code: 'NO_CONTROL_LOCK', message: '제어권이 없습니다' } });
    }

    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'RUNNING', 86400);

    await mqttService.publish(TOPICS.SERVER_SCHEDULER(machineId), {
      timestamp: new Date().toISOString(),
      type: 'RESUME',
    });

    wsService.sendSchedulerState(machineId, 'RUNNING');

    res.json({ success: true });
  } catch (err) {
    console.error('[Scheduler] resume error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '재개 실패' } });
  }
});

// ─── POST /pause?machineId= ──────────────────────────────────────────────────

router.post('/pause', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const { machineId } = req.query as { machineId?: string };
    if (!machineId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'machineId required' } });
    }

    const state = await redisService.get<string>(REDIS_KEYS.SCHEDULER_STATE(machineId)) ?? 'IDLE';
    if (state !== 'RUNNING') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: `현재 상태(${state})에서는 일시정지할 수 없습니다` } });
    }

    const lock = await redisService.getControlLock(machineId);
    if (!lock || lock.ownerId !== req.user!.id) {
      return res.status(403).json({ success: false, error: { code: 'NO_CONTROL_LOCK', message: '제어권이 없습니다' } });
    }

    // Server는 상태 변경을 Agent 보고 후에 처리 — 여기서는 Agent에 원사이클 스톱 요청만 전달
    await mqttService.publish(TOPICS.SERVER_SCHEDULER(machineId), {
      timestamp: new Date().toISOString(),
      type: 'PAUSE',
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Scheduler] pause error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '일시정지 실패' } });
  }
});

// ─── POST /cancel?machineId= ─────────────────────────────────────────────────

router.post('/cancel', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const { machineId } = req.query as { machineId?: string };
    if (!machineId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'machineId required' } });
    }

    const machine = await getMachineByMachineId(machineId);
    if (!machine) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    }

    const lock = await redisService.getControlLock(machineId);
    if (!lock || lock.ownerId !== req.user!.id) {
      return res.status(403).json({ success: false, error: { code: 'NO_CONTROL_LOCK', message: '제어권이 없습니다' } });
    }

    // 실행 중/일시정지 행을 모두 대기로 복귀 (카운트 유지 — 다음 실행 시 이어서 처리)
    await prisma.schedulerRow.updateMany({
      where: { machineDbId: machine.id, status: { in: ['RUNNING', 'PAUSED'] } },
      data: { status: 'PENDING' },
    });

    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'IDLE', 86400);
    await redisService.del(REDIS_KEYS.SCHEDULER_RUNNING(machineId));

    await mqttService.publish(TOPICS.SERVER_SCHEDULER(machineId), {
      timestamp: new Date().toISOString(),
      type: 'CANCEL',
    });

    const allRows = await prisma.schedulerRow.findMany({
      where: { machineDbId: machine.id },
      orderBy: { order: 'asc' },
    });
    wsService.sendSchedulerUpdate(machineId, allRows.map(r => rowToDto(r, machineId)));
    wsService.sendSchedulerState(machineId, 'IDLE');

    res.json({ success: true });
  } catch (err) {
    console.error('[Scheduler] cancel error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '취소 실패' } });
  }
});

// ─── DELETE /rows?machineId= ─────────────────────────────────────────────────
// 전체 행 삭제 (스케줄러 IDLE 상태로 전환)

router.delete('/rows', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const { machineId } = req.query as { machineId?: string };
    if (!machineId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'machineId required' } });
    }

    const machine = await getMachineByMachineId(machineId);
    if (!machine) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    }

    const running = await prisma.schedulerRow.findFirst({ where: { machineDbId: machine.id, status: 'RUNNING' } });
    if (running) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: '실행 중에는 삭제할 수 없습니다' } });
    }

    await prisma.schedulerRow.deleteMany({ where: { machineDbId: machine.id } });
    await redisService.set(REDIS_KEYS.SCHEDULER_ROWS(machineId), []);
    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'IDLE', 86400);

    wsService.sendSchedulerUpdate(machineId, []);
    wsService.sendSchedulerState(machineId, 'IDLE');

    return res.json({ success: true });
  } catch (err) {
    console.error('[Scheduler] clearAll error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '삭제 실패' } });
  }
});

// ─── POST /reset?machineId= ──────────────────────────────────────────────────
// COMPLETED/CANCELLED 행 정리 (큐 초기화)

router.post('/reset', requireRole('ADMIN', 'HQ_ENGINEER'), async (req: Request, res: Response) => {
  try {
    const { machineId } = req.query as { machineId?: string };
    if (!machineId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'machineId required' } });
    }

    const machine = await getMachineByMachineId(machineId);
    if (!machine) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다' } });
    }

    // RUNNING 행이 있으면 초기화 불가
    const running = await prisma.schedulerRow.findFirst({ where: { machineDbId: machine.id, status: 'RUNNING' } });
    if (running) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: '실행 중에는 초기화할 수 없습니다' } });
    }

    // 전체 행 삭제 (큐 완전 초기화)
    await prisma.schedulerRow.deleteMany({ where: { machineDbId: machine.id } });

    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'IDLE', 86400);

    const allRows = await prisma.schedulerRow.findMany({
      where: { machineDbId: machine.id },
      orderBy: { order: 'asc' },
    });
    await redisService.set(REDIS_KEYS.SCHEDULER_ROWS(machineId), allRows.map(r => rowToDto(r, machineId)));

    wsService.sendSchedulerUpdate(machineId, allRows.map(r => rowToDto(r, machineId)));
    wsService.sendSchedulerState(machineId, 'IDLE');

    res.json({ success: true });
  } catch (err) {
    console.error('[Scheduler] reset error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '초기화 실패' } });
  }
});

// ─── Agent 이벤트 처리 함수 (index.ts에서 MQTT 핸들러로 호출) ────────────────

/**
 * M20_COMPLETE: Agent 보고 count를 DB/Redis에 반영 (count authority = Agent)
 */
export async function handleSchedulerM20(
  machineId: string,
  rowId: string,
  count: number
): Promise<void> {
  try {
    const row = await prisma.schedulerRow.update({
      where: { id: rowId },
      data: { count },
    });
    await syncRedisRows(machineId);
    wsService.sendSchedulerCount(machineId, rowId, count);
    // Control Lock TTL 자동 갱신 (M20 수신 = 장비 정상 동작 중)
    await renewControlLockForScheduler(machineId);
    console.log(`[Scheduler] M20 count update: ${machineId} row=${rowId} count=${count}/${row.preset}`);
  } catch (err) {
    console.error('[Scheduler] handleSchedulerM20 error:', err);
  }
}

/**
 * 스케줄러 동작 중 Control Lock TTL을 현재 보유자 기준으로 서버-사이드 갱신
 * Agent는 별도 인증 없이 MQTT로 이 흐름을 트리거한다.
 */
async function renewControlLockForScheduler(machineId: string): Promise<void> {
  try {
    const lock = await redisService.getControlLock(machineId);
    if (lock?.ownerId) {
      await redisService.extendControlLock(machineId, lock.ownerId, 300);
    }
  } catch (err) {
    console.error('[Scheduler] renewControlLock error:', err);
  }
}

/**
 * SCHEDULER_ROW_COMPLETED: 행 완료 처리
 */
export async function handleSchedulerRowCompleted(machineId: string, rowId: string): Promise<void> {
  try {
    await prisma.schedulerRow.update({
      where: { id: rowId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await syncRedisRows(machineId);

    const machine = await getMachineByMachineId(machineId);
    if (machine) {
      const allRows = await prisma.schedulerRow.findMany({
        where: { machineDbId: machine.id },
        orderBy: { order: 'asc' },
      });
      wsService.sendSchedulerUpdate(machineId, allRows.map(r => rowToDto(r, machineId)));
    }
  } catch (err) {
    console.error('[Scheduler] handleSchedulerRowCompleted error:', err);
  }
}

/**
 * SCHEDULER_COMPLETED: 전체 큐 완료 처리
 */
export async function handleSchedulerCompleted(machineId: string): Promise<void> {
  try {
    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'IDLE', 86400);
    await redisService.del(REDIS_KEYS.SCHEDULER_RUNNING(machineId));
    wsService.sendSchedulerState(machineId, 'IDLE');
    console.log(`[Scheduler] Queue completed: ${machineId}`);
  } catch (err) {
    console.error('[Scheduler] handleSchedulerCompleted error:', err);
  }
}

/**
 * SCHEDULER_PAUSED: 원사이클 스톱 완료 또는 인터록 감지 후 정상 정지
 */
export async function handleSchedulerPaused(
  machineId: string,
  rowId?: string,
  code?: string,
  message?: string
): Promise<void> {
  try {
    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'PAUSED', 86400);

    if (rowId) {
      await prisma.schedulerRow.update({
        where: { id: rowId },
        data: {
          status: 'PAUSED',
          lastError: message ?? null,
          lastErrorCode: code ?? null,
          lastErrorAt: message ? new Date() : null,
        },
      });
    }

    const machine = await getMachineByMachineId(machineId);
    if (machine) {
      const allRows = await prisma.schedulerRow.findMany({
        where: { machineDbId: machine.id },
        orderBy: { order: 'asc' },
      });
      wsService.sendSchedulerUpdate(machineId, allRows.map(r => rowToDto(r, machineId)));
    }
    wsService.sendSchedulerState(machineId, 'PAUSED');

    if (code && message) {
      wsService.sendSchedulerError(machineId, code, message, rowId);
    }
  } catch (err) {
    console.error('[Scheduler] handleSchedulerPaused error:', err);
  }
}

/**
 * SCHEDULER_CONTROL_DENIED: 인터락 불만족으로 제어 거부
 * 행 lastError 미기록. 상태 IDLE 유지. WS 알림만 전송.
 */
export async function handleSchedulerControlDenied(
  machineId: string,
  code: string,
  message: string
): Promise<void> {
  try {
    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'IDLE', 86400);
    wsService.sendSchedulerState(machineId, 'IDLE');
    wsService.sendSchedulerError(machineId, code, message, undefined);
    console.log(`[Scheduler] CONTROL DENIED: ${machineId} code=${code}: ${message}`);
  } catch (err) {
    console.error('[Scheduler] handleSchedulerControlDenied error:', err);
  }
}

/**
 * SCHEDULER_ERROR: 비정상 정지 처리
 */
export async function handleSchedulerError(
  machineId: string,
  code: string,
  message: string,
  rowId?: string
): Promise<void> {
  try {
    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'ERROR', 86400);

    if (rowId) {
      // 대기로 복귀 (카운트 유지, 에러 정보 보존 — 다음 실행 시 재시도 가능)
      await prisma.schedulerRow.update({
        where: { id: rowId },
        data: { status: 'PENDING', lastError: message, lastErrorCode: code, lastErrorAt: new Date() },
      });
    } else {
      // rowId 없는 에러 — 모든 RUNNING/PAUSED 행을 대기로
      await prisma.schedulerRow.updateMany({
        where: { machineDbId: (await getMachineByMachineId(machineId))?.id ?? '', status: { in: ['RUNNING', 'PAUSED'] } },
        data: { status: 'PENDING' },
      });
    }

    const machine = await getMachineByMachineId(machineId);
    if (machine) {
      const allRows = await prisma.schedulerRow.findMany({
        where: { machineDbId: machine.id },
        orderBy: { order: 'asc' },
      });
      wsService.sendSchedulerUpdate(machineId, allRows.map(r => rowToDto(r, machineId)));
    }
    // 에러 발생 → 행은 PENDING으로 리셋, 상태는 IDLE — 이벤트 로그에 에러 표시
    await redisService.set(REDIS_KEYS.SCHEDULER_STATE(machineId), 'IDLE', 86400);
    wsService.sendSchedulerState(machineId, 'IDLE');
    wsService.sendSchedulerError(machineId, code, message, rowId);

    console.log(`[Scheduler] ERROR: ${machineId} code=${code} row=${rowId ?? '-'}: ${message}`);
  } catch (err) {
    console.error('[Scheduler] handleSchedulerError error:', err);
  }
}

export default router;

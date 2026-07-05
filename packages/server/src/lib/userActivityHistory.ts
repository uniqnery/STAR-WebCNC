import { prisma } from './prisma';

export type UserActivityPage = 'scheduler' | 'control';

export interface UserActivityActor {
  id?: string;
  username: string;
  role: string;
}

interface RecordUserActivityInput {
  machineId: string;
  page: UserActivityPage;
  actor: UserActivityActor | null;
  action: string;
  detail?: string | null;
  createdAt?: Date;
}

export interface UserActivityHistoryItem {
  id: string;
  machineId: string;
  page: UserActivityPage;
  actor: { username: string; role: string } | null;
  action: string;
  detail?: string;
  timestamp: string;
}

function toItem(row: Awaited<ReturnType<typeof prisma.userActivityHistory.findFirst>>): UserActivityHistoryItem | null {
  if (!row) return null;
  return {
    id: row.id,
    machineId: row.machineCode,
    page: row.page as UserActivityPage,
    actor: row.actorUsername && row.actorRole ? { username: row.actorUsername, role: row.actorRole } : null,
    action: row.action,
    ...(row.detail ? { detail: row.detail } : {}),
    timestamp: row.createdAt.toISOString(),
  };
}

export async function recordUserActivity(input: RecordUserActivityInput): Promise<UserActivityHistoryItem | null> {
  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id: input.machineId }, { machineId: input.machineId }] },
    select: { id: true, machineId: true },
  });
  const machineCode = machine?.machineId ?? input.machineId;

  let actorUserId: string | null = input.actor?.id ?? null;
  if (!actorUserId && input.actor?.username) {
    const user = await prisma.user.findUnique({ where: { username: input.actor.username }, select: { id: true } });
    actorUserId = user?.id ?? null;
  }

  const row = await prisma.userActivityHistory.create({
    data: {
      machineDbId: machine?.id ?? null,
      machineCode,
      page: input.page,
      actorUserId,
      actorUsername: input.actor?.username ?? null,
      actorRole: input.actor?.role ?? null,
      action: input.action,
      detail: input.detail || null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });

  return toItem(row);
}

export async function listUserActivityHistory(
  machineId: string,
  page: UserActivityPage,
  limit = 100
): Promise<UserActivityHistoryItem[]> {
  const safeLimit = Math.max(1, Math.min(limit || 100, 200));
  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id: machineId }, { machineId }] },
    select: { id: true, machineId: true },
  });
  const machineCode = machine?.machineId ?? machineId;

  const rows = await prisma.userActivityHistory.findMany({
    where: { machineCode, page },
    orderBy: { createdAt: 'desc' },
    take: safeLimit,
  });

  return rows.map((row) => toItem(row)).filter((item): item is UserActivityHistoryItem => Boolean(item));
}
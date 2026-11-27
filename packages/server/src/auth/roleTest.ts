import { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';

export function validTestRole(value: unknown): value is UserRole {
  return value === 'USER' || value === 'ADMIN' || value === 'HQ_ENGINEER';
}

// The signed login identity and the current DB account must both be HQ.
export async function resolveTestRole(identity: { id: string; role: UserRole }, requested: unknown): Promise<UserRole> {
  if (!validTestRole(requested) || identity.role !== 'HQ_ENGINEER') throw new Error('ROLE_TEST_FORBIDDEN');
  const account = await prisma.user.findUnique({ where: { id: identity.id }, select: { role: true, isActive: true, isApproved: true } });
  if (!account?.isActive || !account.isApproved || account.role !== 'HQ_ENGINEER') throw new Error('ROLE_TEST_FORBIDDEN');
  return requested;
}

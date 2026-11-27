export type TestRole = 'ADMIN' | 'USER';
const KEY = 'star-webcnc-role-test';
export function readRoleTest(userId: string): TestRole | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    return saved?.userId === userId && (saved.role === 'ADMIN' || saved.role === 'USER') ? saved.role : null;
  } catch { return null; }
}
export function writeRoleTest(userId: string, role: TestRole | null) {
  if (role) sessionStorage.setItem(KEY, JSON.stringify({ userId, role }));
  else sessionStorage.removeItem(KEY);
}

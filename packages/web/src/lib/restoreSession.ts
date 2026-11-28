import type { User } from '../stores/authStore';

let pending: Promise<{ user: User; accessToken: string } | null> | null = null;

// StrictMode and concurrent mounts must not rotate one refresh token twice.
export function restorePersistentSession() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restoreSession: true }) });
      if (!response.ok) return null;
      const result = await response.json();
      const token = result.data?.accessToken;
      if (!result.success || !token || result.data.rememberMe === false) return null;
      const me = await fetch('/api/auth/me', { credentials: 'include', headers: { Authorization: `Bearer ${token}` } });
      if (!me.ok) return null;
      const account = await me.json();
      return account.success && account.data ? { user: account.data as User, accessToken: token as string } : null;
    } catch { return null; }
  })().finally(() => { pending = null; });
  return pending;
}

import { useEffect } from 'react';
import { authApi } from '../lib/api';
import { wsClient } from '../lib/wsClient';
import { useAuthStore } from '../stores/authStore';

// Current DB role is enforced on every server request; keep visible menus in sync too.
export function useAccountSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      const before = useAuthStore.getState();
      if (!before.accessToken || !before.user) return;
      pending = true;
      try {
        const response = await authApi.me();
        const current = useAuthStore.getState();
        if (!active || current.user?.id !== before.user.id) return;
        if (response.success && response.data && current.accessToken) {
          const next = response.data;
          if (current.user.role !== next.role || current.user.actualRole !== (next.actualRole ?? next.role)
            || !!current.user.isRepresentative !== !!next.isRepresentative || current.user.displayName !== next.displayName || !!current.user.mustChangePassword !== !!next.mustChangePassword)
            current.setAuth(next, current.accessToken);
        } else if (response.error?.code === 'ACCOUNT_DISABLED') current.logout();
      } catch { /* Keep the session during temporary connection failures. */ }
      finally { pending = false; }
    };
    const visible = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const off = wsClient.onMessage(m => { if (m.type === 'account_changed') void refresh(); });
    const offConnect = wsClient.onConnect(() => void refresh());
    void refresh();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(visible, 30000);
    return () => { active = false; off(); offConnect(); clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [enabled]);
}

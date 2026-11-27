import { useEffect } from 'react';
import { useTemplateStore } from '../stores/templateStore';
import { wsClient } from '../lib/wsClient';

export function useTemplateSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { void useTemplateStore.getState().refreshTemplates().catch(() => undefined); };
    const visible = () => { if (document.visibilityState !== 'hidden') refresh(); };
    const offMessage = wsClient.onMessage(message => { if (message.type === 'template_changed') refresh(); });
    const offConnect = wsClient.onConnect(refresh);
    refresh();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(visible, 30000);
    return () => { offMessage(); offConnect(); clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [enabled]);
}

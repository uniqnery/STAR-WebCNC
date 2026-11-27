import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../lib/api';

export function ProfileSettings() {
  const user = useAuthStore(s => s.user);
  const [name, setName] = useState(user?.displayName || user?.username || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    void authApi.me().then(response => {
      if (cancelled || !response.success || !response.data) return;
      setName(response.data.displayName || response.data.username);
      const token = useAuthStore.getState().accessToken;
      if (token) useAuthStore.getState().setAuth(response.data, token);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [user?.id]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await authApi.updateProfile(name.trim());
      if (!response.success || !response.data) { setMessage(response.error?.message || '저장 실패'); return; }
      useAuthStore.getState().setAuth(response.data.user, response.data.accessToken);
      setName(response.data.user.displayName || response.data.user.username);
      setMessage('저장되었습니다.');
    } catch { setMessage('저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  return <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
    <h2 className="text-lg font-semibold mb-4">내 계정</h2>
    <form onSubmit={save} className="space-y-3">
      <div><span className="text-sm text-gray-500">로그인 ID</span><div className="font-mono">{user?.username}</div></div>
      <label className="block text-sm">사용자명 (이름)
        <input aria-label="사용자명 (이름)" value={name} onChange={e => setName(e.target.value)} maxLength={80} required disabled={busy}
          className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
      </label>
      <button type="submit" disabled={busy || !name.trim()} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{busy ? '저장 중...' : '저장'}</button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>
  </section>;
}

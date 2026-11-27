import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import { useAuthStore, type UserRole } from '../stores/authStore';
import { useMachineStore } from '../stores/machineStore';

export const ROLE_NAMES = { HQ_ENGINEER: '본사 엔지니어', ADMIN: '업체 관리자', USER: '일반 사용자' };

export function RoleTestControl({ banner = false }: { banner?: boolean }) {
  const { user, testRole, setTestRole, roleTestChanging: busy, setRoleTestChanging: setBusy } = useAuthStore();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  if ((user?.actualRole ?? user?.role) !== 'HQ_ENGINEER' || (banner && !testRole)) return null;
  const change = async (role: UserRole) => {
    if (useAuthStore.getState().roleTestChanging || role === user?.role) return;
    setBusy(true); setError('');
    try {
      const response = await authApi.setTestRole(role);
      if (!response.success || !response.data) throw new Error(response.error?.message ?? '권한 전환 실패');
      for (const id of response.data.releasedMachines) useMachineStore.getState().releaseControlLock(id);
      useMachineStore.getState().destroyWebSocket();
      setTestRole(response.data.role);
      navigate('/');
      void useMachineStore.getState().fetchMachines();
    } catch (e) {
      setError(e instanceof Error ? e.message : '권한 전환 실패');
      void useMachineStore.getState().fetchMachines();
    }
    finally { setBusy(false); }
  };
  return (
    <div className={banner ? 'bg-amber-100 text-amber-950 px-3 py-2 text-sm shrink-0 flex flex-wrap items-center gap-2' : 'mt-3 text-sm'}>
      {banner ? <>
        <strong>권한 테스트 중: {ROLE_NAMES[testRole!]}</strong>
        <span>실제 계정: {user?.displayName || user?.username} · 본사 엔지니어</span>
        <button disabled={busy} onClick={() => void change('HQ_ENGINEER')} className="underline font-semibold disabled:opacity-50">본사 권한으로 복귀</button>
      </> : <>
        <label className="block text-gray-400 mb-1" htmlFor="role-test-select">권한 테스트</label>
        <select id="role-test-select" value={user?.role} disabled={busy} onChange={e => void change(e.target.value as UserRole)}
          className="w-full bg-gray-800 text-white border border-gray-600 rounded px-2 py-2 disabled:opacity-50">
          {Object.entries(ROLE_NAMES).map(([role, name]) => <option key={role} value={role}>{name}</option>)}
        </select>
        <p className="text-xs text-gray-400 mt-1">현재 탭에 적용 · 조작과 데이터 수정은 실제 반영됩니다.</p>
      </>}
      {busy && <span>권한 전환 중…</span>}
      {error && <p role="alert" className="text-red-500">{error}</p>}
    </div>
  );
}

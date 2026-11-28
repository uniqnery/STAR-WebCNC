import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

export function PasswordChange({ required = false }: { required?: boolean }) {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <section className="bg-white dark:bg-gray-800 dark:text-white rounded-xl shadow p-[24px] mb-[24px]">
    <h2 className="text-[18px] font-semibold mb-[16px]">{required ? '임시 비밀번호 변경' : '비밀번호 변경'}</h2>
    {required && <p className="text-[14px] text-gray-500 mb-[20px]">관리자에게 받은 임시 비밀번호를 새 비밀번호로 변경한 후 이용하세요.</p>}
    <form className="space-y-[16px]" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setError('');
      if (password !== confirm || currentPassword === password) { setError('현재 비밀번호와 다른 새 비밀번호를 입력하고 확인 값을 맞춰주세요.'); return; }
      setBusy(true);
      try { const r = await authApi.changePassword(currentPassword, password, confirm); if (!r.success) throw new Error(r.error?.message || '변경 실패');
        useAuthStore.getState().logout(); navigate('/login', { replace: true });
      } catch (e) { setError(e instanceof Error ? e.message : '변경 실패'); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="space-y-[16px]">
        {([{ label: required ? '임시 비밀번호' : '현재 비밀번호', value: currentPassword, update: setCurrentPassword, current: true }, { label: '새 비밀번호', value: password, update: setPassword }, { label: '새 비밀번호 확인', value: confirm, update: setConfirm }]).map(field => <label key={field.label} className="block text-[14px]">{field.label}<input type="password" value={field.value} onChange={e => field.update(e.target.value)} autoComplete={field.current ? 'current-password' : 'new-password'} required minLength={field.current ? undefined : 6} maxLength={128} className="block w-full h-[48px] mt-[4px] px-[12px] text-[16px] rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700" /></label>)}
        <button className="w-full h-[48px] rounded-lg bg-blue-600 text-white text-[16px]">{busy ? '변경 중...' : '비밀번호 변경 후 다시 로그인'}</button>
      </fieldset>
      {error && <p role="alert" className="text-[14px] text-red-500">{error}</p>}
    </form>
    {required && <button className="mt-[20px] text-[14px] text-gray-500" onClick={() => { void authApi.logout().finally(() => { useAuthStore.getState().logout(); navigate('/login'); }); }}>로그아웃</button>}
  </section>;
}

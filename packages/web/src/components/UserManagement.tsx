import { useCallback, useEffect, useState } from 'react';
import { settingsApi, usersApi, type ManagedUser } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { wsClient } from '../lib/wsClient';

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';
const roleName = (user: ManagedUser) => user.role === 'HQ_ENGINEER' ? '본사 엔지니어' : user.isRepresentative ? '대표 관리자' : user.role === 'ADMIN' ? '업체 관리자' : '일반 사용자';

export function UserManagement() {
  const actor = useAuthStore(s => s.user);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [temporary, setTemporary] = useState<{ username: string; password: string } | null>(null);
  useEffect(() => { setTemporary(null); }, [actor?.id, actor?.role, actor?.isRepresentative]);
  const isHq = actor?.role === 'HQ_ENGINEER';
  const canSetRole = isHq || !!actor?.isRepresentative;
  const canSeeCode = actor?.role === 'ADMIN' && actor.actualRole !== 'HQ_ENGINEER';
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await usersApi.list();
      if (!response.success || !response.data) throw new Error(response.error?.message || '가입자 목록을 불러오지 못했습니다.');
      setUsers(response.data.items); setError('');
    } catch (e) { setUsers([]); setError(e instanceof Error ? e.message : '조회 실패'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const off = wsClient.onMessage(m => { if (m.type === 'users_changed') void load(); });
    return off;
  }, [load]);
  const change = async (user: ManagedUser, changes: Parameters<typeof usersApi.update>[1], label: string) => {
    if (!window.confirm(`${user.displayName || user.username} (${user.username}) — ${label}하시겠습니까?`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await usersApi.update(user.id, changes);
      if (!response.success) throw new Error(response.error?.message || '변경 실패');
      await load(); setMessage('변경되었습니다.');
    } catch (e) { setError(e instanceof Error ? e.message : '변경 실패'); }
    finally { setBusy(false); }
  };
  const designate = async (user: ManagedUser | null) => {
    const previous = users.find(u => u.isRepresentative);
    if (!window.confirm(user ? `${user.displayName || user.username} (${user.username})을 대표 관리자로 지정하시겠습니까?${previous ? ` 기존 대표 ${previous.displayName || previous.username}은 업체 관리자로 유지됩니다.` : ''}` : '대표 관리자 지정을 해제하시겠습니까? 업체 관리자 권한은 유지됩니다.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await usersApi.setRepresentative(user?.id ?? null);
      if (!response.success) throw new Error(response.error?.message || '지정 실패');
      await load(); setMessage(user ? '대표 관리자가 지정되었습니다.' : '대표 관리자 지정이 해제되었습니다.');
    } catch (e) { setError(e instanceof Error ? e.message : '지정 실패'); }
    finally { setBusy(false); }
  };
  const shown = users.filter(user => `${user.displayName} ${user.username} ${user.email}`.toLowerCase().includes(query.toLowerCase()));
  const resetPassword = async (user: ManagedUser) => {
    if (!window.confirm(`${user.username}의 비밀번호를 초기화하시겠습니까? 기존 로그인이 해제되며 다음 로그인에서 새 비밀번호를 설정해야 합니다.`)) return;
    setBusy(true); setError(''); setMessage(''); setTemporary(null);
    try { const r = await usersApi.resetPassword(user.id); if (!r.success || !r.data) throw new Error(r.error?.message || '초기화 실패'); setTemporary({ username: user.username, password: r.data.temporaryPassword }); }
    catch (e) { setError(e instanceof Error ? e.message : '초기화 실패'); } finally { setBusy(false); }
  };
  const remove = async (user: ManagedUser) => {
    const confirmed = window.prompt(`계정 이용을 종료하고 가입자 목록에서 삭제합니다. 작업 이력과 로그인 ID는 보존합니다. 삭제할 로그인 ID '${user.username}'를 입력하세요.`);
    if (confirmed !== user.username) return;
    setBusy(true); setError(''); setMessage(''); setTemporary(null);
    try { const r = await usersApi.remove(user.id, confirmed); if (!r.success) throw new Error(r.error?.message || '삭제 실패'); await load(); setMessage('계정이 삭제되었습니다.'); }
    catch (e) { setError(e instanceof Error ? e.message : '삭제 실패'); } finally { setBusy(false); }
  };
  return <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-6 mb-6">
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="text-lg font-semibold">사용자 관리</h2>
      <button onClick={() => void load()} disabled={loading || busy} className="text-sm text-blue-500 disabled:opacity-50">새로고침</button>
    </div>
    <input aria-label="가입자 검색" placeholder="이름 · 로그인 ID · 이메일 검색" value={query} onChange={e => setQuery(e.target.value)}
      className="w-full border rounded bg-transparent p-2 mb-3 dark:border-gray-600" />
    {error && <p role="alert" className="text-sm text-red-500 mb-3">{error}</p>}
    {message && <p role="status" className="text-sm text-green-600 mb-3">{message}</p>}
    {temporary && <div role="dialog" aria-label="임시 비밀번호" className="border border-blue-500 rounded-lg p-4 mb-4">
      <p>{temporary.username} 임시 비밀번호</p><p className="font-mono text-[18px] break-all select-all my-3">{temporary.password}</p>
      <p className="text-sm text-gray-500">지금 한 번만 표시됩니다. 사용자에게 직접 전달하세요. 첫 로그인에서 변경해야 합니다.</p>
      <button className="mt-3 rounded border px-3 py-2" onClick={() => setTemporary(null)}>확인 · 닫기</button>
    </div>}
    {loading && <p className="text-sm text-gray-500 mb-3">조회 중...</p>}
    {!loading && !error && !shown.length && <p className="text-sm text-gray-500">가입자가 없습니다.</p>}
    <div className="space-y-3 max-h-[38rem] overflow-y-auto">
      {shown.map(user => {
        const protectedUser = user.id === actor?.id || user.role === 'HQ_ENGINEER' || user.isRepresentative;
        const canManage = !protectedUser && (canSetRole || user.role === 'USER');
        const canReset = user.id !== actor?.id && user.role !== 'HQ_ENGINEER' && user.isActive && user.isApproved && (isHq || (actor?.isRepresentative && !user.isRepresentative) || user.role === 'USER');
        const buttonClass = 'border dark:border-gray-600 rounded px-2 py-1 text-sm disabled:opacity-50';
        return <article key={user.id} aria-label={`가입자 ${user.username}`} className="border dark:border-gray-700 rounded p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <strong>{user.displayName || user.username}</strong><span className="font-mono text-sm">{user.username}</span>
            <span className="text-sm text-blue-500">{roleName(user)}</span>
            <span className="text-sm text-gray-500">{!user.isActive ? '비활성' : user.isApproved ? '승인됨' : '승인 대기'}</span>
          </div>
          <div className="text-sm text-gray-500 break-all mt-1">{user.email}</div>
          <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span>가입 {dateTime(user.createdAt)}</span><span>최근 로그인 {dateTime(user.lastLoginAt)}</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {canManage && <>
              <button className={buttonClass} disabled={busy} onClick={() => void change(user, { isApproved: !user.isApproved }, user.isApproved ? '승인을 취소' : '가입을 승인')}>{user.isApproved ? '승인 취소' : '가입 승인'}</button>
              <button className={buttonClass} disabled={busy} onClick={() => void change(user, { isActive: !user.isActive }, user.isActive ? '계정을 비활성화' : '계정을 활성화')}>{user.isActive ? '비활성화' : '활성화'}</button>
              {canSetRole && <button className={buttonClass} disabled={busy || !user.isApproved || !user.isActive}
                onClick={() => void change(user, { role: user.role === 'ADMIN' ? 'USER' : 'ADMIN' }, user.role === 'ADMIN' ? '일반 사용자로 변경' : '업체 관리자로 지정')}>{user.role === 'ADMIN' ? '일반 사용자로 변경' : '관리자 지정'}</button>}
            </>}
            {isHq && user.role !== 'HQ_ENGINEER' && !user.isRepresentative && <button className={buttonClass} disabled={busy || !user.isApproved || !user.isActive} onClick={() => void designate(user)}>대표 관리자 지정</button>}
            {isHq && user.isRepresentative && <button className={buttonClass} disabled={busy} onClick={() => void designate(null)}>대표 지정 해제</button>}
            {canReset && <button className={buttonClass} disabled={busy} onClick={() => void resetPassword(user)}>비밀번호 초기화</button>}
            {isHq && !protectedUser && <button className={`${buttonClass} text-red-500`} disabled={busy} onClick={() => void remove(user)}>계정 삭제</button>}
          </div>
        </article>;
      })}
    </div>
    {canSeeCode && <RegistrationCode />}
  </section>;
}

function RegistrationCode() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void settingsApi.getRegistrationCodes().then(response => {
      if (!active) return;
      if (response.success && response.data) setCode(response.data.operatorCode);
      else setMessage(response.error?.message || '가입 코드 조회 실패');
    }).catch(() => { if (active) setMessage('가입 코드 조회 실패'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await settingsApi.updateRegistrationCodes({ operatorCode: code.trim() });
      setMessage(response.success ? '저장되었습니다.' : response.error?.message || '저장 실패');
    } catch { setMessage('저장 실패'); }
    finally { setBusy(false); }
  };
  return <form onSubmit={save} className="border-t dark:border-gray-700 mt-5 pt-4">
    <label className="block text-sm font-semibold">업체 가입 코드
      <input aria-label="업체 가입 코드" value={code} onChange={e => setCode(e.target.value)} required minLength={4} maxLength={128} disabled={loading || busy}
        className="block w-full mt-2 border dark:border-gray-600 rounded p-2 bg-transparent font-mono" />
    </label>
    <p className="text-xs text-gray-500 mt-2">이 코드로 가입하면 일반 사용자로 승인됩니다. 관리자 권한은 별도로 지정합니다.</p>
    <button disabled={loading || busy || code.trim().length < 4} className="mt-3 rounded bg-blue-600 text-white px-4 py-2 text-sm disabled:opacity-50">{busy ? '저장 중...' : '가입 코드 저장'}</button>
    {message && <p role="status" className="text-sm mt-2">{message}</p>}
  </form>;
}

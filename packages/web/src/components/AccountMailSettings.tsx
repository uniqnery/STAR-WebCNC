import { useEffect, useState } from 'react';
import { accountRecoveryApi } from '../lib/api';

export function AccountMailSettings() {
  const [form, setForm] = useState({ host: '', port: 465, username: '', from: '', publicUrl: window.location.origin, password: '' });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [hasPassword, setHasPassword] = useState(false);
  const [message, setMessage] = useState(''), [testEmail, setTestEmail] = useState('');
  useEffect(() => { let active = true; void accountRecoveryApi.mailSettings().then(r => {
    if (!active) return;
    if (r.success && r.data) { setForm({ ...r.data, password: '' }); setHasPassword(r.data.hasPassword); }
    else if (!r.success) setMessage(r.error?.message || '설정 조회 실패');
  }).catch(() => { if (active) setMessage('설정 조회 실패'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const input = 'mt-1 block w-full border dark:border-gray-600 rounded-lg bg-transparent p-2';
  return <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6 dark:text-white">
    <h2 className="text-lg font-semibold">계정 복구 메일 설정</h2><p className="text-sm text-gray-500 mt-1 mb-4">가입 이메일 인증·아이디 안내·비밀번호 재설정에 사용합니다.</p>
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage(''); try {
      const r = await accountRecoveryApi.saveMailSettings(form); setMessage(r.success ? '저장되었습니다.' : r.error?.message || '저장 실패');
      if (r.success) { setHasPassword(true); setForm(s => ({ ...s, password: '' })); }
    } catch { setMessage('저장 실패'); } finally { setBusy(false); } }}>
      <fieldset disabled={loading || busy} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">메일 서버<input className={input} required value={form.host} onChange={e => setForm(s => ({ ...s, host: e.target.value }))} placeholder="smtp.example.com" /></label>
          <label className="text-sm">포트<select className={`${input} dark:bg-gray-800`} value={form.port} onChange={e => setForm(s => ({ ...s, port: Number(e.target.value) }))}><option value={465}>465 · SSL/TLS</option><option value={587}>587 · STARTTLS</option></select></label></div>
        {(['username', 'from', 'publicUrl', 'password'] as const).map(key => <label key={key} className="block text-sm">{{ username: '메일 로그인 계정', from: '발신 이메일', publicUrl: '외부 접속 웹주소 (HTTPS)', password: '메일 앱 비밀번호' }[key]}
          <input className={input} type={key === 'password' ? 'password' : key === 'from' ? 'email' : key === 'publicUrl' ? 'url' : 'text'} required={key !== 'password' || !hasPassword} autoComplete={key === 'password' ? 'new-password' : 'off'} value={form[key]} onChange={e => setForm(s => ({ ...s, [key]: e.target.value }))} placeholder={key === 'password' && hasPassword ? '저장됨 · 변경할 때만 입력' : ''} /></label>)}
        <button className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm">{busy ? '저장 중...' : '메일 설정 저장'}</button>
      </fieldset>
    </form>
    <form className="border-t dark:border-gray-700 mt-5 pt-4 flex flex-wrap gap-3" onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage(''); try { const r = await accountRecoveryApi.testMail(testEmail); setMessage(r.success ? '테스트 메일을 발송했습니다.' : r.error?.message || '발송 실패'); } catch { setMessage('발송 실패'); } finally { setBusy(false); } }}>
      <input aria-label="테스트 메일 수신 주소" type="email" required value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="테스트 메일 수신 주소" className="border dark:border-gray-600 rounded-lg bg-transparent p-2 text-sm flex-1 min-w-0" />
      <button disabled={loading || busy || !hasPassword} className="border dark:border-gray-600 rounded-lg px-3 py-2 text-sm disabled:opacity-50">테스트 메일 보내기</button>
    </form>
    {message && <p role="status" className="mt-3 text-sm text-gray-500">{message}</p>}
  </section>;
}

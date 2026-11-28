import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthCard } from '../components/AuthCard';
import { authApi } from '../lib/api';

export function AccountRecovery({ mode }: { mode: 'find-id' | 'forgot-password' | 'reset' }) {
  const findId = mode === 'find-id';
  const [name, setName] = useState(''), [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false), [result, setResult] = useState(''), [error, setError] = useState('');
  const clear = () => { setResult(''); setError(''); };
  const input = 'w-full h-[48px] px-[12px] py-[8px] text-[16px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'block text-[14px] leading-[20px] font-medium text-gray-700 dark:text-gray-300 mb-[4px]';
  return <AuthCard>
    <h2 className={findId ? 'sr-only' : 'font-semibold text-[18px] leading-[24px] mb-[16px]'}>{findId ? '아이디 찾기' : '비밀번호 찾기'}</h2>
    {findId ? <form aria-label="아이디 찾기" className="space-y-[20px]" onSubmit={async e => {
      e.preventDefault(); if (busy) return; clear(); setBusy(true);
      try { const r = await authApi.findId(name.trim(), email.trim()); if (!r.success || !r.data) throw new Error(r.error?.message || '조회 실패');
        setResult(r.data.maskedId ? `로그인 ID: ${r.data.maskedId}` : '일치하는 계정을 찾을 수 없습니다. 등록한 이름·이메일을 확인하거나 업체 관리자에게 문의하세요.');
      } catch (e) { setError(e instanceof Error ? e.message : '조회 실패'); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="min-w-0 space-y-[20px]">
        <div><label htmlFor="lookup-name" className={label}>사용자명 (이름)</label><input id="lookup-name" className={input} value={name} onChange={e => { setName(e.target.value); clear(); }} autoComplete="name" required maxLength={80} /></div>
        <div><label htmlFor="lookup-email" className={label}>가입 이메일</label><input id="lookup-email" className={input} type="email" value={email} onChange={e => { setEmail(e.target.value); clear(); }} autoComplete="email" autoCapitalize="none" required maxLength={320} /></div>
        <p className="text-[12px] leading-[20px] text-gray-500">가입 정보와 일치해야 합니다.</p>
        <button className="w-full h-[48px] py-[8px] px-[16px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[16px] font-medium transition-colors">{busy ? '조회 중...' : '아이디 확인'}</button>
      </fieldset>
      {result && <p role="status" className="text-[14px] leading-[24px] break-all">{result}</p>}
      {error && <p role="alert" className="text-[14px] leading-[24px] text-red-500">{error}</p>}
    </form> : <>
      <p className="text-[14px] leading-[24px] text-gray-500">업체 관리자에게 비밀번호 초기화를 요청해 주세요. 발급받은 임시 비밀번호로 로그인하면 새 비밀번호를 설정할 수 있습니다.</p>
      <p className="mt-[16px] text-[14px] leading-[24px] text-gray-500">대표 관리자 계정은 본사 엔지니어에게, 본사 계정은 본사 담당자에게 문의해 주세요.</p>
    </>}
    <Link to="/login" className={findId ? 'block mt-[32px] text-center text-[12px] sm:text-[14px] leading-[20px] text-gray-500 hover:text-blue-500 py-2' : 'block mt-[32px] text-center text-[14px] text-gray-500 hover:text-blue-500 py-[8px]'}>로그인으로 돌아가기</Link>
  </AuthCard>;
}

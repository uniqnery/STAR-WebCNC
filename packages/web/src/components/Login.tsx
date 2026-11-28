// Login Component

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../lib/api';
import { AuthCard } from './AuthCard';

export function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await authApi.login(username, password, rememberMe);

      if (response.success && response.data) {
        setAuth(response.data.user, response.data.accessToken, rememberMe);
        navigate('/');
      } else {
        setError(response.error?.message || '로그인에 실패했습니다.');
      }
    } catch (err) {
      setError('서버 연결에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthCard>
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-[20px]" autoComplete="on" aria-label="로그인">
            <div>
              <label
                htmlFor="username"
                className="block text-[14px] leading-[20px] font-medium text-gray-700 dark:text-gray-300 mb-[4px]"
              >
                로그인 ID
              </label>
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-[48px] px-[12px] py-[8px] text-[16px] border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="로그인 ID 입력"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-[14px] leading-[20px] font-medium text-gray-700 dark:text-gray-300 mb-[4px]"
              >
                비밀번호
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-[48px] px-[12px] py-[8px] text-[16px] border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="비밀번호 입력"
                required
                autoComplete="current-password"
              />
            </div>

            <label className="flex items-center gap-[8px] text-[14px] leading-[20px] text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-[16px] w-[16px] rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              자동 로그인
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-[48px] py-[8px] px-[16px] text-[16px] bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400
                       text-white font-medium rounded-lg transition-colors
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  로그인 중...
                </span>
              ) : (
                '로그인'
              )}
            </button>
          </form>

          <nav aria-label="계정 도움말" className="mt-[32px] flex flex-wrap items-center justify-center gap-x-[8px] text-[12px] sm:text-[14px] leading-[20px] text-gray-500 dark:text-gray-400">
            <Link to="/account/find-id" className="py-2 hover:text-blue-500">아이디 찾기</Link><span aria-hidden="true" className="text-gray-300 dark:text-gray-600">|</span>
            <Link to="/account/forgot-password" className="py-2 hover:text-blue-500">비밀번호 찾기</Link><span aria-hidden="true" className="text-gray-300 dark:text-gray-600">|</span>
            <Link to="/register" className="py-2 hover:text-blue-500">회원가입</Link>
          </nav>

    </AuthCard>
  );
}

// Login Component

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../lib/api';

const REMEMBERED_USERNAME_KEY = 'star-webcnc-remembered-username';

function getRememberedUsername(): string {
  try {
    return localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveRememberedUsername(username: string | null): void {
  try {
    if (username) localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
    else localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  } catch {
    // 저장소를 사용할 수 없는 경우에도 로그인은 계속 진행
  }
}

export function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const devLogin = useAuthStore((state) => state.devLogin);

  const rememberedUsername = getRememberedUsername();
  const [username, setUsername] = useState(rememberedUsername);
  const [password, setPassword] = useState('');
  const [rememberUsername, setRememberUsername] = useState(Boolean(rememberedUsername));
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleDevLogin = () => {
    devLogin();
    navigate('/');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await authApi.login(username, password);

      if (response.success && response.data) {
        if (rememberUsername) {
          saveRememberedUsername(username.trim());
        } else {
          saveRememberedUsername(null);
        }
        setAuth(response.data.user, response.data.accessToken);
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
      <div className="max-w-md w-full mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Star-WebCNC
          </h1>
          <p className="text-gray-500 mt-2">CNC 스마트팩토리 시스템</p>
        </div>

        {/* Login Form */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
            로그인
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                로그인 ID
              </label>
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
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
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                비밀번호
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="비밀번호 입력"
                required
                autoComplete="current-password"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={rememberUsername}
                onChange={(e) => setRememberUsername(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              아이디 기억
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400
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

          {/* Register Link */}
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
            <p className="text-sm text-gray-500">
              계정이 없으신가요?{' '}
              <Link
                to="/register"
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                회원가입
              </Link>
            </p>
          </div>

          {/* Dev Login */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 text-center mb-3">백엔드 없이 UI 테스트</p>
            <button
              type="button"
              onClick={handleDevLogin}
              className="w-full py-2 px-4 bg-gray-600 hover:bg-gray-700
                       text-white font-medium rounded-lg transition-colors
                       focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              개발자 로그인 (Mock 데이터)
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-sm mt-8">
          &copy; 2026 Star-WebCNC. All rights reserved.
        </p>
      </div>
    </div>
  );
}

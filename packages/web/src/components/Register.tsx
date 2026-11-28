// Register Component

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../lib/api';
import { AuthBrand } from './AuthBrand';

export function Register() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    username: '',
    displayName: '',
    email: '',
    password: '',
    passwordConfirm: '',
    registrationCode: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (formData.password !== formData.passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    if (formData.password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await authApi.register(
        formData.username,
        formData.email,
        formData.password,
        formData.registrationCode,
        formData.displayName
      );

      if (response.success) {
        alert('회원가입이 완료되었습니다. 로그인해 주세요.');
        navigate('/login');
      } else {
        setError(response.error?.message || '회원가입에 실패했습니다.');
      }
    } catch (err) {
      setError('서버 연결에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls =
    'w-full h-[48px] px-[12px] py-[8px] text-[16px] border border-gray-300 dark:border-gray-600 rounded-lg ' +
    'bg-white dark:bg-gray-700 text-gray-900 dark:text-white ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="min-h-screen min-h-[100svh] flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-[16px] py-[32px]">
      <div className="max-w-[400px] w-full">
        {/* Register Form */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg px-[24px] py-[36px] sm:px-[32px] sm:py-[40px]">
          <AuthBrand compact />
          <h2 className="text-[18px] leading-[24px] font-semibold text-gray-900 dark:text-white mb-[24px]">
            회원가입
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-[20px]">
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
                value={formData.username}
                onChange={handleChange}
                className={inputCls}
                placeholder="로그인 ID 입력"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label
                htmlFor="displayName"
                className="block text-[14px] leading-[20px] font-medium text-gray-700 dark:text-gray-300 mb-[4px]"
              >
                사용자명 (이름)
              </label>
              <input id="displayName" name="displayName" type="text" value={formData.displayName} onChange={handleChange}
                className={inputCls} placeholder="이름 입력" autoComplete="name" maxLength={80} required />
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-[14px] leading-[20px] font-medium text-gray-700 dark:text-gray-300 mb-[4px]"
              >
                이메일 (선택)
              </label>
              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                className={inputCls}
                placeholder="이메일 입력 (선택)"
                autoComplete="email"
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
                value={formData.password}
                onChange={handleChange}
                className={inputCls}
                placeholder="비밀번호 입력 (6자 이상)"
                required
                autoComplete="new-password"
              />
            </div>

            <div>
              <label
                htmlFor="passwordConfirm"
                className="block text-[14px] leading-[20px] font-medium text-gray-700 dark:text-gray-300 mb-[4px]"
              >
                비밀번호 확인
              </label>
              <input
                id="passwordConfirm"
                name="passwordConfirm"
                type="password"
                value={formData.passwordConfirm}
                onChange={handleChange}
                className={inputCls}
                placeholder="비밀번호 다시 입력"
                required
                autoComplete="new-password"
              />
            </div>

            {/* Registration Code */}
            <div>
              <label
                htmlFor="registrationCode"
                className="block text-[14px] leading-[20px] font-medium text-gray-700 dark:text-gray-300 mb-[4px]"
              >
                가입 코드
              </label>
              <input
                id="registrationCode"
                name="registrationCode"
                type="text"
                value={formData.registrationCode}
                onChange={handleChange}
                className={inputCls}
                placeholder="업체 가입 코드 입력"
                required
                autoComplete="off"
              />
              <p className="mt-[4px] text-[12px] leading-[20px] text-gray-400">
                업체 관리자에게 받은 가입 코드가 필요합니다.
              </p>
            </div>

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
                  가입 중...
                </span>
              ) : (
                '회원가입'
              )}
            </button>
          </form>

          {/* Login Link */}
          <div className="mt-[32px] text-center">
            <p className="text-[12px] sm:text-[14px] leading-[20px] text-gray-500">
              이미 계정이 있으신가요?{' '}
              <Link
                to="/login"
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                로그인
              </Link>
            </p>
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

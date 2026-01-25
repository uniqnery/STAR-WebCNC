// Control Lock Button Component

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { machineApi } from '../lib/api';

interface ControlLockButtonProps {
  machineId: string;
  currentLock?: {
    ownerId: string;
    ownerUsername: string;
    acquiredAt: string;
  } | null;
  onLockChange?: (hasLock: boolean) => void;
}

export function ControlLockButton({
  machineId,
  currentLock,
  onLockChange,
}: ControlLockButtonProps) {
  const user = useAuthStore((state) => state.user);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());

  const isMyLock = currentLock?.ownerId === user?.id;
  const isLocked = !!currentLock;

  // Heartbeat to extend lock
  useEffect(() => {
    if (!isMyLock) return;

    const interval = setInterval(async () => {
      try {
        await machineApi.extendControl(machineId);
      } catch (err) {
        console.error('Failed to extend control lock:', err);
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [machineId, isMyLock]);

  const handleAcquire = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await machineApi.acquireControl(machineId, sessionId);
      if (response.success) {
        onLockChange?.(true);
      } else {
        setError(response.error?.message || '제어권 획득 실패');
      }
    } catch (err) {
      setError('서버 연결 오류');
    } finally {
      setIsLoading(false);
    }
  }, [machineId, sessionId, onLockChange]);

  const handleRelease = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await machineApi.releaseControl(machineId);
      if (response.success) {
        onLockChange?.(false);
      } else {
        setError(response.error?.message || '제어권 반납 실패');
      }
    } catch (err) {
      setError('서버 연결 오류');
    } finally {
      setIsLoading(false);
    }
  }, [machineId, onLockChange]);

  // Check if user has permission to control
  const canControl = user?.role === 'ADMIN' || user?.role === 'AS';

  if (!canControl) {
    return (
      <div className="text-sm text-gray-500">
        제어 권한이 없습니다
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Lock Status */}
      {isLocked && !isMyLock && (
        <div className="flex items-center gap-2 p-2 bg-orange-50 dark:bg-orange-900/20 rounded text-sm">
          <LockIcon className="w-4 h-4 text-orange-500" />
          <span className="text-orange-700 dark:text-orange-300">
            {currentLock.ownerUsername}님이 제어 중
          </span>
        </div>
      )}

      {isMyLock && (
        <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded text-sm">
          <LockIcon className="w-4 h-4 text-green-500" />
          <span className="text-green-700 dark:text-green-300">
            제어권 보유 중
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Button */}
      {isMyLock ? (
        <button
          onClick={handleRelease}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2
                   bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400
                   text-white rounded-lg transition-colors"
        >
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <>
              <UnlockIcon className="w-4 h-4" />
              제어권 반납
            </>
          )}
        </button>
      ) : (
        <button
          onClick={handleAcquire}
          disabled={isLoading || (isLocked && !isMyLock)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2
                   bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400
                   text-white rounded-lg transition-colors"
        >
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <>
              <LockIcon className="w-4 h-4" />
              제어권 획득
            </>
          )}
        </button>
      )}

      {/* Info */}
      <p className="text-xs text-gray-500 text-center">
        제어권 획득 후 5분간 유효 (자동 연장)
      </p>
    </div>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function UnlockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

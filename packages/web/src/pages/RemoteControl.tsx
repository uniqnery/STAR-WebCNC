// Remote Control Page - Virtual Operation Panel

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMachineStore, useMachineTelemetry } from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { ControlLockButton } from '../components/ControlLockButton';
import { InterlockBar } from '../components/InterlockBar';
import { commandApi, machineApi } from '../lib/api';

type CncMode = 'EDIT' | 'MEM' | 'MDI' | 'JOG' | 'REF' | 'HANDLE';

export function RemoteControl() {
  const { machineId } = useParams<{ machineId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const machines = useMachineStore((state) => state.machines);
  const telemetry = useMachineTelemetry(machineId || '');

  const [hasControlLock, setHasControlLock] = useState(false);
  const [selectedMode, setSelectedMode] = useState<CncMode | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [feedOverride, setFeedOverride] = useState(100);
  const [spindleOverride, setSpindleOverride] = useState(100);
  const [commandResult, setCommandResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const machine = machines.find((m) => m.machineId === machineId);

  // Check control lock status
  useEffect(() => {
    if (!machineId) return;

    const checkLock = async () => {
      const response = await machineApi.getById(machineId);
      if (response.success && response.data) {
        const data = response.data as any;
        setHasControlLock(data.realtime?.controlLock?.ownerId === user?.id);
      }
    };

    checkLock();
  }, [machineId, user?.id]);

  // Send command helper
  const sendCommand = useCallback(async (command: string, params?: Record<string, unknown>) => {
    if (!machineId || !hasControlLock) return;

    setIsExecuting(true);
    setCommandResult(null);

    try {
      const response = await commandApi.send(machineId, command, params);
      if (response.success) {
        setCommandResult({ success: true, message: '명령 전송 완료' });

        // Poll for result
        if (response.data?.correlationId) {
          setTimeout(async () => {
            const statusRes = await commandApi.getStatus(machineId, response.data!.correlationId);
            if (statusRes.success) {
              const data = statusRes.data as any;
              if (data.status === 'SUCCESS') {
                setCommandResult({ success: true, message: '명령 실행 완료' });
              } else if (data.status === 'FAILURE') {
                setCommandResult({ success: false, message: data.errorMessage || '명령 실패' });
              }
            }
          }, 2000);
        }
      } else {
        setCommandResult({ success: false, message: response.error?.message || '명령 전송 실패' });
      }
    } catch (err) {
      setCommandResult({ success: false, message: '서버 연결 오류' });
    } finally {
      setIsExecuting(false);
    }
  }, [machineId, hasControlLock]);

  if (!machineId || !machine) {
    return (
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">장비를 선택해주세요</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            대시보드로 이동
          </button>
        </div>
      </div>
    );
  }

  const canControl = hasControlLock && !telemetry?.alarmActive;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            원격 제어
          </h1>
          <p className="text-gray-500">{machine.name} ({machine.machineId})</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 text-gray-600 hover:text-gray-900 dark:text-gray-400"
        >
          ← 대시보드
        </button>
      </div>

      {/* Command Result Toast */}
      {commandResult && (
        <div
          className={`mb-4 p-3 rounded-lg ${
            commandResult.success
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {commandResult.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Machine Status */}
        <div className="space-y-4">
          {/* Current Status */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">현재 상태</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatusItem label="모드" value={telemetry?.mode || '-'} />
              <StatusItem
                label="상태"
                value={getRunStateText(telemetry?.runState)}
                highlight={telemetry?.runState === 2}
              />
              <StatusItem label="프로그램" value={telemetry?.programNo || '-'} />
              <StatusItem
                label="알람"
                value={telemetry?.alarmActive ? '발생' : '없음'}
                error={telemetry?.alarmActive}
              />
            </div>
          </div>

          {/* Spindle & Feed */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">속도 정보</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">스핀들</span>
                  <span className="font-mono">{telemetry?.spindleSpeed || 0} rpm</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">이송속도</span>
                  <span className="font-mono">{telemetry?.feedrate || 0} mm/min</span>
                </div>
              </div>
            </div>
          </div>

          {/* Position */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">좌표 (절대)</h3>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {['X', 'Y', 'Z', 'A'].map((axis, i) => (
                <div key={axis} className="flex justify-between bg-gray-50 dark:bg-gray-700 p-2 rounded">
                  <span className="text-gray-500">{axis}</span>
                  <span>{formatPosition(telemetry?.absolutePosition?.[i])}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Control Lock */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">제어권</h3>
            <ControlLockButton
              machineId={machineId}
              currentLock={machine.realtime?.controlLock}
              onLockChange={setHasControlLock}
            />
          </div>
        </div>

        {/* Center: Virtual Panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Interlock Status */}
          <InterlockBar machineId={machineId} />

          {/* Mode Selection */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">모드 선택</h3>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {(['EDIT', 'MEM', 'MDI', 'JOG', 'REF', 'HANDLE'] as CncMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setSelectedMode(mode);
                    sendCommand('SET_MODE', { mode });
                  }}
                  disabled={!canControl || isExecuting}
                  className={`px-3 py-2 rounded font-medium text-sm transition-colors ${
                    telemetry?.mode === mode
                      ? 'bg-blue-600 text-white'
                      : selectedMode === mode
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Control Buttons */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">실행 제어</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ControlButton
                label="CYCLE START"
                color="green"
                onClick={() => sendCommand('CYCLE_START')}
                disabled={!canControl || isExecuting}
              />
              <ControlButton
                label="FEED HOLD"
                color="yellow"
                onClick={() => sendCommand('FEED_HOLD')}
                disabled={!canControl || isExecuting}
              />
              <ControlButton
                label="RESET"
                color="red"
                onClick={() => sendCommand('RESET')}
                disabled={!canControl || isExecuting}
              />
              <ControlButton
                label="SINGLE BLOCK"
                color="blue"
                onClick={() => sendCommand('SINGLE_BLOCK_TOGGLE')}
                disabled={!canControl || isExecuting}
              />
            </div>
          </div>

          {/* Override Controls */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">오버라이드</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Feed Override */}
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-500">이송 오버라이드</span>
                  <span className="font-mono">{feedOverride}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="150"
                  step="10"
                  value={feedOverride}
                  onChange={(e) => setFeedOverride(parseInt(e.target.value))}
                  onMouseUp={() => sendCommand('SET_FEED_OVERRIDE', { value: feedOverride })}
                  disabled={!canControl}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0%</span>
                  <span>100%</span>
                  <span>150%</span>
                </div>
              </div>

              {/* Spindle Override */}
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-500">스핀들 오버라이드</span>
                  <span className="font-mono">{spindleOverride}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="120"
                  step="10"
                  value={spindleOverride}
                  onChange={(e) => setSpindleOverride(parseInt(e.target.value))}
                  onMouseUp={() => sendCommand('SET_SPINDLE_OVERRIDE', { value: spindleOverride })}
                  disabled={!canControl}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>50%</span>
                  <span>100%</span>
                  <span>120%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Warning */}
          {!hasControlLock && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-yellow-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div>
                  <h4 className="font-medium text-yellow-800 dark:text-yellow-300">제어권 필요</h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
                    원격 제어를 사용하려면 먼저 제어권을 획득하세요.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper Components
function StatusItem({
  label,
  value,
  highlight,
  error,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  error?: boolean;
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700 rounded p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={`font-semibold ${
          error
            ? 'text-red-600'
            : highlight
            ? 'text-green-600'
            : 'text-gray-900 dark:text-white'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ControlButton({
  label,
  color,
  onClick,
  disabled,
}: {
  label: string;
  color: 'green' | 'yellow' | 'red' | 'blue';
  onClick: () => void;
  disabled: boolean;
}) {
  const colors = {
    green: 'bg-green-600 hover:bg-green-700 text-white',
    yellow: 'bg-yellow-500 hover:bg-yellow-600 text-white',
    red: 'bg-red-600 hover:bg-red-700 text-white',
    blue: 'bg-blue-600 hover:bg-blue-700 text-white',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-3 rounded-lg font-medium transition-colors ${colors[color]} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}

function getRunStateText(runState?: number): string {
  switch (runState) {
    case 0: return 'STOP';
    case 1: return 'HOLD';
    case 2: return 'START';
    case 3: return 'MSTR';
    case 4: return 'RESTART';
    default: return '-';
  }
}

function formatPosition(value?: number): string {
  if (value === undefined || value === null) return '-';
  return (value / 1000).toFixed(3);
}

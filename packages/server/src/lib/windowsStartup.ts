import { execFile } from 'child_process';
import path from 'path';
import os from 'os';
import { promisify } from 'util';

const exec = promisify(execFile);
const script = path.resolve(__dirname, '../../../../tools/windows-startup.ps1');
let changeInProgress = false;

export interface WindowsStartupStatus {
  supported: boolean;
  enabled: boolean;
  serverName: string;
  windowsUser?: string;
  taskName?: string;
  taskState?: string;
  lastRunAt?: string | null;
  lastTaskResult?: number | null;
  report?: { stage: string; message: string; checkedAt: string; agentCount?: number } | null;
}

export class WindowsStartupError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

const messages: Record<string, string> = {
  STARTUP_ADMIN_REQUIRED: 'Windows 예약 작업 등록 권한이 필요합니다. 서버 PC에서 Windows 계정의 예약 작업 등록 권한을 확인해 주세요.',
  STARTUP_TASK_CONFLICT: '같은 이름의 Windows 작업이 다른 경로나 사용자에 등록되어 있습니다.',
  STARTUP_DEPENDENCIES_MISSING: '서버 PC에 Node.js, .NET과 Docker 설치가 필요합니다.',
  STARTUP_CONFIGURATION_FAILED: 'Windows 자동 시작 설정을 확인하지 못했습니다. 서버 PC의 예약 작업 권한과 설치 파일을 확인해 주세요.',
};

async function run(action: 'Status' | 'Enable' | 'Disable'): Promise<WindowsStartupStatus> {
  if (process.platform !== 'win32') {
    if (action === 'Status') return { supported: false, enabled: false, serverName: os.hostname() };
    throw new WindowsStartupError('WINDOWS_REQUIRED', 'Windows 서버 PC에서 지원하는 기능입니다.');
  }
  let output: string;
  try {
    const result = await exec('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action,
    ], { windowsHide: true, timeout: 25000, maxBuffer: 256 * 1024 });
    output = result.stdout;
  } catch (error) {
    const failed = error as { stdout?: string };
    let code = 'STARTUP_CONFIGURATION_FAILED';
    try { code = JSON.parse(failed.stdout?.trim() ?? '{}').error ?? code; } catch {}
    throw new WindowsStartupError(code, messages[code] ?? messages.STARTUP_CONFIGURATION_FAILED);
  }
  try {
    const status: WindowsStartupStatus = JSON.parse(output.trim());
    if (typeof status.enabled !== 'boolean' || !status.serverName) throw new Error();
    return status;
  } catch {
    throw new WindowsStartupError('STARTUP_CONFIGURATION_FAILED', messages.STARTUP_CONFIGURATION_FAILED);
  }
}

export const getWindowsStartup = () => run('Status');

export async function setWindowsStartup(enabled: boolean): Promise<WindowsStartupStatus> {
  if (changeInProgress) throw new WindowsStartupError('STARTUP_BUSY', '다른 자동 시작 설정 변경이 진행 중입니다.');
  changeInProgress = true;
  try {
    const status = await run(enabled ? 'Enable' : 'Disable');
    if (status.enabled !== enabled) throw new WindowsStartupError('STARTUP_CONFIGURATION_FAILED', messages.STARTUP_CONFIGURATION_FAILED);
    return status;
  } finally {
    changeInProgress = false;
  }
}

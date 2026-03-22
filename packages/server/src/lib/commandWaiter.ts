/**
 * CommandWaiter - 서버 사이드 명령 응답 대기 레지스트리
 *
 * 흐름:
 *   POST /api/commands/:id?wait=true
 *     → mqttService.sendCommand()       (MQTT → Agent)
 *     → commandWaiter.wait(correlationId, 30s)   ← 여기서 blocking
 *     ← AGENT_COMMAND_RESULT 수신 시 resolve()
 *     ← HTTP 응답 반환 (result 포함)
 *
 * 단일 서버 배포에 최적화된 in-memory 구현.
 * 다중 서버 환경에서는 Redis Pub/Sub으로 교체 가능.
 */

const DEFAULT_TIMEOUT_MS = 30_000; // 30초

export interface CommandResult {
  status: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  result?: unknown;
}

interface PendingEntry {
  resolve: (r: CommandResult) => void;
  reject:  (e: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}

class CommandWaiter {
  private readonly pending = new Map<string, PendingEntry>();

  /**
   * correlationId에 대한 결과를 최대 timeoutMs 동안 대기
   */
  wait(correlationId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new Error(`Command timeout (correlationId=${correlationId})`));
      }, timeoutMs);

      this.pending.set(correlationId, { resolve, reject, timer });
    });
  }

  /**
   * MQTT AGENT_COMMAND_RESULT 수신 시 호출 — waiting Promise를 resolve
   * @returns 대기 중인 엔트리가 있으면 true, 없으면 false (fire-and-forget 명령)
   */
  notify(correlationId: string, result: CommandResult): boolean {
    const entry = this.pending.get(correlationId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(correlationId);
    entry.resolve(result);
    return true;
  }

  /**
   * 현재 대기 중인 명령 수
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}

export const commandWaiter = new CommandWaiter();

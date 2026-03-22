// WebSocket Client - Singleton service for real-time server connection
// Handles connect/disconnect/reconnect and message dispatching

export interface WsMessage {
  type: string;
  timestamp: string;
  payload: unknown;
}

type MessageHandler = (msg: WsMessage) => void;
type ConnectHandler = () => void;
type DisconnectHandler = () => void;

const RECONNECT_DELAY_MS = 5000;
// 60s 이상 메시지가 없으면 좀비 연결로 판단하여 강제 재연결
// (서버의 ws.terminate()가 산업용 네트워크에서 클라이언트에 도달하지 못하는 경우 대비)
const STALE_TIMEOUT_MS = 60_000;
const STALE_CHECK_MS   = 30_000;

class WsClientService {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stalenessTimer: ReturnType<typeof setInterval> | null = null;
  private tokenGetter: () => string = () => '';
  private shouldReconnect: boolean = false;
  private lastMessageAt: number = 0; // 0 = 아직 메시지 미수신

  private readonly messageHandlers: Set<MessageHandler> = new Set();
  private readonly connectHandlers: Set<ConnectHandler> = new Set();
  private readonly disconnectHandlers: Set<DisconnectHandler> = new Set();

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * WebSocket 연결. tokenGetter는 매 재연결 시 호출되어 항상 최신 토큰을 사용.
   * 기존 connect(token: string) 호환을 위해 string도 허용.
   */
  connect(tokenOrGetter: string | (() => string)): void {
    this._clearStalenessTimer();
    // Disconnect existing connection first (e.g. token changed)
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.shouldReconnect = false;
      this.ws.close(1000, 'Reconnecting');
      this.ws = null;
    }
    this.tokenGetter = typeof tokenOrGetter === 'function'
      ? tokenOrGetter
      : () => tokenOrGetter;
    this.shouldReconnect = true;
    this._connect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this._clearStalenessTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  subscribe(machineIds: string[]): void {
    this.send({ type: 'subscribe', payload: { machineIds } });
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnect(handler: ConnectHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  onDisconnect(handler: DisconnectHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  private _clearStalenessTimer(): void {
    if (this.stalenessTimer) {
      clearInterval(this.stalenessTimer);
      this.stalenessTimer = null;
    }
  }

  private _connect(): void {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const token = this.tokenGetter();
    // API 서버에 직접 연결 (Vite proxy 우회 — proxy가 서버→브라우저 메시지를 제대로 전달 못함)
    const apiBase: string = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const wsBase = apiBase.replace(/^http/, 'ws');
    const url = `${wsBase}/ws?token=${encodeURIComponent(token)}`;

    try {
      // 로컬 변수에 저장 — 클로저가 this.ws가 아닌 생성 시점의 인스턴스를 참조해야 함
      // React StrictMode 이중 마운트 시 이전 WS의 onclose가 새 WS를 null로 덮어쓰는 버그 방지
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        // 이미 더 새로운 연결로 교체된 경우 이벤트 무시
        if (this.ws !== ws) return;
        console.log('[WsClient] Connected to server');
        this.lastMessageAt = 0; // 새 연결 — 첫 메시지 수신 전에는 staleness 판단 안 함
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.connectHandlers.forEach((h) => h());

        // 좀비 연결 감지: 연결은 OPEN이지만 메시지가 없을 때 강제 재연결
        // M-15: 로컬 ws 변수 클로저로 캡처, this.ws !== ws 체크로 오래된 타이머 무효화
        this._clearStalenessTimer();
        this.stalenessTimer = setInterval(() => {
          if (this.ws !== ws) {
            // 더 새로운 연결이 생성됨 — 이 타이머는 더 이상 유효하지 않음
            this._clearStalenessTimer();
            return;
          }
          if (this.lastMessageAt > 0 && Date.now() - this.lastMessageAt > STALE_TIMEOUT_MS) {
            console.warn('[WsClient] Connection stale (no messages for 60s), forcing reconnect');
            ws.close(4000, 'Stale connection');
          }
        }, STALE_CHECK_MS);
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this.lastMessageAt = Date.now();
        try {
          const msg = JSON.parse(event.data as string) as WsMessage;
          this.messageHandlers.forEach((h) => h(msg));
        } catch {
          console.warn('[WsClient] Failed to parse message:', event.data);
        }
      };

      ws.onclose = (event) => {
        console.log(`[WsClient] Disconnected: ${event.code} ${event.reason}`);
        // 현재 활성 연결인 경우에만 정리 — 오래된 연결의 onclose가 새 연결을 null로 덮어쓰지 않도록
        if (this.ws === ws) {
          this._clearStalenessTimer();
          this.ws = null;
          this.disconnectHandlers.forEach((h) => h());
          if (this.shouldReconnect) {
            console.log(`[WsClient] Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
            this.reconnectTimer = setTimeout(
              () => this._connect(),
              RECONNECT_DELAY_MS
            );
          }
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, handling reconnect there
        console.warn('[WsClient] WebSocket error');
      };
    } catch (err) {
      console.error('[WsClient] Failed to create WebSocket:', err);
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(
          () => this._connect(),
          RECONNECT_DELAY_MS
        );
      }
    }
  }
}

// HMR 시 이전 인스턴스 연결 해제 (개발 환경에서 연결 중복 방지)
declare const __WS_INSTANCE__: WsClientService | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _prev = (globalThis as any).__wsClientInstance as WsClientService | undefined;
if (_prev) {
  _prev.disconnect();
}
export const wsClient = new WsClientService();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__wsClientInstance = wsClient;
export default wsClient;

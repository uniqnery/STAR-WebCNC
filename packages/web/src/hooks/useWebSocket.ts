// WebSocket Hook

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMachineStore, TelemetryData, Alarm } from '../stores/machineStore';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws';

interface WsMessage {
  type: string;
  timestamp: string;
  payload: unknown;
}

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isAuthenticated, accessToken } = useAuthStore();
  const { updateTelemetry, addAlarm, clearAlarm } = useMachineStore();

  const connect = useCallback(() => {
    if (!isAuthenticated) return;

    // Use token in query param for WebSocket auth
    const wsUrl = accessToken
      ? `${WS_URL}?token=${accessToken}`
      : WS_URL;

    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('[WebSocket] Connected');
      setIsConnected(true);
      setError(null);
    };

    ws.current.onclose = (event) => {
      console.log('[WebSocket] Disconnected', event.code, event.reason);
      setIsConnected(false);

      // Reconnect after 5 seconds if authenticated
      if (isAuthenticated && event.code !== 1000) {
        reconnectTimeout.current = setTimeout(() => {
          console.log('[WebSocket] Reconnecting...');
          connect();
        }, 5000);
      }
    };

    ws.current.onerror = (event) => {
      console.error('[WebSocket] Error', event);
      setError('WebSocket 연결 오류');
    };

    ws.current.onmessage = (event) => {
      try {
        const message: WsMessage = JSON.parse(event.data);
        handleMessage(message);
      } catch (err) {
        console.error('[WebSocket] Failed to parse message', err);
      }
    };
  }, [isAuthenticated, accessToken]);

  const handleMessage = useCallback((message: WsMessage) => {
    switch (message.type) {
      case 'connected':
        console.log('[WebSocket] Welcome message received');
        break;

      case 'telemetry': {
        const payload = message.payload as {
          machineId: string;
          data: TelemetryData;
        };
        updateTelemetry(payload.machineId, payload.data);
        break;
      }

      case 'alarm': {
        const payload = message.payload as {
          machineId: string;
          alarmNo: number;
          alarmMsg: string;
          type: 'occurred' | 'cleared';
        };

        if (payload.type === 'occurred') {
          addAlarm(payload.machineId, {
            id: `${payload.machineId}-${payload.alarmNo}-${Date.now()}`,
            alarmNo: payload.alarmNo,
            alarmMsg: payload.alarmMsg,
            occurredAt: message.timestamp,
          });
        } else {
          clearAlarm(payload.machineId, payload.alarmNo);
        }
        break;
      }

      case 'event': {
        const payload = message.payload as {
          machineId: string;
          eventType: string;
          programNo?: string;
          count?: number;
        };
        console.log('[WebSocket] Event:', payload.eventType, payload);
        break;
      }

      case 'scheduler': {
        // Handle scheduler updates
        console.log('[WebSocket] Scheduler update:', message.payload);
        break;
      }

      case 'pong':
        // Heartbeat response
        break;

      default:
        console.log('[WebSocket] Unknown message type:', message.type);
    }
  }, [updateTelemetry, addAlarm, clearAlarm]);

  const subscribe = useCallback((machineIds: string[]) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'subscribe',
        payload: { machineIds },
      }));
    }
  }, []);

  const unsubscribe = useCallback((machineIds: string[]) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'unsubscribe',
        payload: { machineIds },
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }
    if (ws.current) {
      ws.current.close(1000, 'User disconnect');
      ws.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [isAuthenticated, connect, disconnect]);

  return {
    isConnected,
    error,
    subscribe,
    unsubscribe,
    disconnect,
  };
}

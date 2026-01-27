// WebSocket Hook

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMachineStore, TelemetryData } from '../stores/machineStore';
import { WS_RECONNECT_DELAY } from '../lib/constants';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws';

interface WsMessage {
  type: string;
  timestamp: string;
  payload: unknown;
}

export interface M20Event {
  machineId: string;
  programNo: string;
  count: number;
  timestamp: string;
}

export interface AlarmEvent {
  machineId: string;
  alarmNo: number;
  alarmMsg: string;
  type: 'occurred' | 'cleared';
  timestamp: string;
}

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastM20Event, setLastM20Event] = useState<M20Event | null>(null);
  const [lastAlarm, setLastAlarm] = useState<AlarmEvent | null>(null);

  const { isAuthenticated, accessToken } = useAuthStore();
  const { updateTelemetry, addAlarm, clearAlarm } = useMachineStore();

  const connect = useCallback(() => {
    if (!isAuthenticated) return;

    const wsUrl = accessToken
      ? `${WS_URL}?token=${accessToken}`
      : WS_URL;

    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.current.onclose = (event) => {
      setIsConnected(false);

      // Reconnect after delay if authenticated
      if (isAuthenticated && event.code !== 1000) {
        reconnectTimeout.current = setTimeout(() => {
          connect();
        }, WS_RECONNECT_DELAY);
      }
    };

    ws.current.onerror = () => {
      setError('WebSocket 연결 오류');
    };

    ws.current.onmessage = (event) => {
      try {
        const message: WsMessage = JSON.parse(event.data);
        handleMessage(message);
      } catch {
        // Failed to parse message
      }
    };
  }, [isAuthenticated, accessToken]);

  const handleMessage = useCallback((message: WsMessage) => {
    switch (message.type) {
      case 'connected':
        // Welcome message received
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

        setLastAlarm({
          ...payload,
          timestamp: message.timestamp,
        });

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

        if (payload.eventType === 'M20_COMPLETE') {
          setLastM20Event({
            machineId: payload.machineId,
            programNo: payload.programNo || '',
            count: payload.count || 0,
            timestamp: message.timestamp,
          });
        }
        break;
      }

      case 'scheduler':
      case 'pong':
        // No action needed
        break;

      default:
        // Unknown message type
        break;
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
    lastM20Event,
    lastAlarm,
  };
}

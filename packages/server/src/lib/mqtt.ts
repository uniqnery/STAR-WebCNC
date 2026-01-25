// MQTT Client Module
// Connects to MQTT broker for Agent communication

import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { config } from '../config';

// MQTT Topics
export const TOPICS = {
  // Agent → Server
  AGENT_STATUS: 'star-webcnc/agent/+/status',           // Agent 상태 보고
  AGENT_TELEMETRY: 'star-webcnc/agent/+/telemetry',     // 장비 실시간 데이터
  AGENT_ALARM: 'star-webcnc/agent/+/alarm',             // 알람 발생/해제
  AGENT_COMMAND_RESULT: 'star-webcnc/agent/+/command/result', // 명령 실행 결과
  AGENT_EVENT: 'star-webcnc/agent/+/event',             // M20 등 이벤트

  // Server → Agent
  COMMAND: 'star-webcnc/server/command',                // 브로드캐스트 명령
  COMMAND_TO: (machineId: string) => `star-webcnc/server/command/${machineId}`, // 특정 장비 명령
  SERVER_SCHEDULER: (machineId: string) => `star-webcnc/server/scheduler/${machineId}`, // 스케줄러 명령
} as const;

// Message types
export interface MqttMessage {
  timestamp: string;
  machineId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface AgentStatusMessage extends MqttMessage {
  machineId: string;
  status: 'online' | 'offline' | 'error';
  version: string;
  uptime: number;
}

export interface TelemetryMessage extends MqttMessage {
  machineId: string;
  data: {
    runState: number;
    mode: string;
    programNo: string;
    feedrate: number;
    spindleSpeed: number;
    partsCount: number;
    alarmActive: boolean;
  };
}

export interface AlarmMessage extends MqttMessage {
  machineId: string;
  eventId: string;
  type: 'occurred' | 'cleared';
  alarmNo: number;
  alarmMsg: string;
  category?: string;
}

export interface CommandMessage extends MqttMessage {
  correlationId: string;
  command: string;
  params?: Record<string, unknown>;
}

export interface CommandResultMessage extends MqttMessage {
  machineId: string;
  correlationId: string;
  status: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  result?: unknown;
}

export interface EventMessage extends MqttMessage {
  machineId: string;
  eventType: 'M20_COMPLETE' | 'PROGRAM_START' | 'PROGRAM_END';
  programNo?: string;
  data?: Record<string, unknown>;
}

// Event handlers type
type MessageHandler<T extends MqttMessage = MqttMessage> = (
  topic: string,
  message: T
) => void | Promise<void>;

class MqttService {
  private client: MqttClient | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;

  /**
   * Connect to MQTT broker
   */
  async connect(): Promise<void> {
    if (this.client?.connected) {
      console.log('[MQTT] Already connected');
      return;
    }

    const options: IClientOptions = {
      clientId: `star-webcnc-server-${process.pid}`,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 5000,
      keepalive: 60,
    };

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(config.mqttBrokerUrl, options);

      this.client.on('connect', () => {
        console.log('[MQTT] Connected to broker');
        this.reconnectAttempts = 0;
        this.subscribeToTopics();
        resolve();
      });

      this.client.on('error', (err) => {
        console.error('[MQTT] Connection error:', err);
        if (this.reconnectAttempts === 0) {
          reject(err);
        }
      });

      this.client.on('reconnect', () => {
        this.reconnectAttempts++;
        console.log(`[MQTT] Reconnecting... (attempt ${this.reconnectAttempts})`);
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('[MQTT] Max reconnect attempts reached');
          this.client?.end();
        }
      });

      this.client.on('close', () => {
        console.log('[MQTT] Connection closed');
      });

      this.client.on('message', (topic, payload) => {
        this.handleMessage(topic, payload);
      });
    });
  }

  /**
   * Subscribe to all agent topics
   */
  private subscribeToTopics(): void {
    if (!this.client) return;

    const topics = [
      TOPICS.AGENT_STATUS,
      TOPICS.AGENT_TELEMETRY,
      TOPICS.AGENT_ALARM,
      TOPICS.AGENT_COMMAND_RESULT,
      TOPICS.AGENT_EVENT,
    ];

    this.client.subscribe(topics, { qos: 1 }, (err) => {
      if (err) {
        console.error('[MQTT] Subscribe error:', err);
      } else {
        console.log('[MQTT] Subscribed to topics:', topics);
      }
    });
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const message = JSON.parse(payload.toString()) as MqttMessage;

      // Find matching handlers
      for (const [pattern, handlers] of this.handlers) {
        if (this.topicMatches(pattern, topic)) {
          handlers.forEach(handler => {
            try {
              handler(topic, message);
            } catch (err) {
              console.error('[MQTT] Handler error:', err);
            }
          });
        }
      }
    } catch (err) {
      console.error('[MQTT] Failed to parse message:', err);
    }
  }

  /**
   * Check if topic matches pattern (supports + and # wildcards)
   */
  private topicMatches(pattern: string, topic: string): boolean {
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '#') {
        return true;
      }
      if (patternParts[i] === '+') {
        continue;
      }
      if (patternParts[i] !== topicParts[i]) {
        return false;
      }
    }

    return patternParts.length === topicParts.length;
  }

  /**
   * Register message handler
   */
  on<T extends MqttMessage>(topic: string, handler: MessageHandler<T>): void {
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set());
    }
    this.handlers.get(topic)!.add(handler as MessageHandler);
  }

  /**
   * Remove message handler
   */
  off(topic: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(topic);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Publish message to topic
   */
  publish(topic: string, message: MqttMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client?.connected) {
        reject(new Error('MQTT client not connected'));
        return;
      }

      const payload = JSON.stringify({
        ...message,
        timestamp: message.timestamp || new Date().toISOString(),
      });

      this.client.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Send command to specific machine
   */
  async sendCommand(
    machineId: string,
    command: string,
    correlationId: string,
    params?: Record<string, unknown>
  ): Promise<void> {
    const message: CommandMessage = {
      timestamp: new Date().toISOString(),
      correlationId,
      command,
      params,
    };

    await this.publish(TOPICS.COMMAND_TO(machineId), message);
  }

  /**
   * Disconnect from broker
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.end();
      this.client = null;
      console.log('[MQTT] Disconnected');
    }
  }

  /**
   * Check connection status
   */
  get isConnected(): boolean {
    return this.client?.connected ?? false;
  }
}

// Singleton instance
export const mqttService = new MqttService();
export default mqttService;

// WebSocket Server Module
// Real-time communication with browser clients

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { parse as parseCookie } from 'cookie';
import { v4 as uuidv4 } from 'uuid';
import { verifyAccessToken, verifyRefreshToken } from '../auth/jwt';
import { config } from '../config';
import { prisma } from './prisma';
import { UserRole } from '@prisma/client';

// Client info attached to WebSocket
export interface WsClient {
  id: string;
  userId: string;
  username: string;
  role: UserRole;
  subscribedMachines: Set<string>;
  isAlive: boolean;
}

// WebSocket with client info
export interface ExtendedWebSocket extends WebSocket {
  client: WsClient;
}

// Message types from client
export interface WsIncomingMessage {
  type: string;
  payload?: unknown;
}

export interface SubscribeMessage extends WsIncomingMessage {
  type: 'subscribe';
  payload: {
    machineIds: string[];
  };
}

export interface UnsubscribeMessage extends WsIncomingMessage {
  type: 'unsubscribe';
  payload: {
    machineIds: string[];
  };
}

// Message types to client
export interface WsOutgoingMessage {
  type: string;
  timestamp: string;
  payload: unknown;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ExtendedWebSocket> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize WebSocket server
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      verifyClient: async (info, callback) => {
        try {
          const user = await this.authenticateRequest(info.req);
          if (user) {
            // Attach user to request for later use
            (info.req as IncomingMessage & { user: WsClient }).user = {
              id: uuidv4(),
              userId: user.id,
              username: user.username,
              role: user.role,
              subscribedMachines: new Set(),
              isAlive: true,
            };
            callback(true);
          } else {
            callback(false, 401, 'Unauthorized');
          }
        } catch (err) {
          console.error('[WebSocket] Auth error:', err);
          callback(false, 401, 'Unauthorized');
        }
      },
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws as ExtendedWebSocket, req);
    });

    // Heartbeat to detect dead connections
    this.pingInterval = setInterval(() => {
      this.heartbeat();
    }, 30000);

    console.log('[WebSocket] Server initialized');
  }

  /**
   * Authenticate WebSocket connection request
   */
  private async authenticateRequest(
    req: IncomingMessage
  ): Promise<{ id: string; username: string; role: UserRole } | null> {
    // Try Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = verifyAccessToken(token);
      if (payload) {
        return {
          id: payload.sub,
          username: payload.username,
          role: payload.role,
        };
      }
    }

    // Try cookie authentication
    const cookies = req.headers.cookie;
    if (cookies) {
      const parsed = parseCookie(cookies);
      const refreshToken = parsed[config.cookie.refreshTokenName];

      if (refreshToken) {
        const payload = verifyRefreshToken(refreshToken);
        if (payload) {
          // Verify token in database
          const storedToken = await prisma.refreshToken.findUnique({
            where: { jti: payload.jti },
            include: { user: true },
          });

          if (storedToken && !storedToken.revokedAt && storedToken.user.isActive) {
            return {
              id: storedToken.user.id,
              username: storedToken.user.username,
              role: storedToken.user.role,
            };
          }
        }
      }
    }

    // Try query parameter (for testing)
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (token) {
      const payload = verifyAccessToken(token);
      if (payload) {
        return {
          id: payload.sub,
          username: payload.username,
          role: payload.role,
        };
      }
    }

    return null;
  }

  /**
   * Handle new connection
   */
  private handleConnection(ws: ExtendedWebSocket, req: IncomingMessage): void {
    const client = (req as IncomingMessage & { user: WsClient }).user;
    ws.client = client;
    this.clients.set(client.id, ws);

    console.log(`[WebSocket] Client connected: ${client.username} (${client.id})`);

    // Send welcome message
    this.sendTo(ws, {
      type: 'connected',
      timestamp: new Date().toISOString(),
      payload: {
        clientId: client.id,
        username: client.username,
        role: client.role,
      },
    });

    // Handle messages
    ws.on('message', (data) => {
      this.handleMessage(ws, data);
    });

    // Handle pong (heartbeat response)
    ws.on('pong', () => {
      ws.client.isAlive = true;
    });

    // Handle close
    ws.on('close', () => {
      console.log(`[WebSocket] Client disconnected: ${client.username} (${client.id})`);
      this.clients.delete(client.id);
    });

    // Handle error
    ws.on('error', (err) => {
      console.error(`[WebSocket] Client error (${client.id}):`, err);
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(ws: ExtendedWebSocket, data: unknown): void {
    try {
      const message: WsIncomingMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(ws, message as SubscribeMessage);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(ws, message as UnsubscribeMessage);
          break;

        case 'ping':
          this.sendTo(ws, {
            type: 'pong',
            timestamp: new Date().toISOString(),
            payload: null,
          });
          break;

        default:
          console.warn(`[WebSocket] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error('[WebSocket] Failed to parse message:', err);
    }
  }

  /**
   * Handle subscribe to machine updates
   */
  private handleSubscribe(ws: ExtendedWebSocket, message: SubscribeMessage): void {
    const machineIds = message.payload?.machineIds || [];
    machineIds.forEach((id) => {
      ws.client.subscribedMachines.add(id);
    });

    this.sendTo(ws, {
      type: 'subscribed',
      timestamp: new Date().toISOString(),
      payload: {
        machineIds: Array.from(ws.client.subscribedMachines),
      },
    });

    console.log(
      `[WebSocket] ${ws.client.username} subscribed to: ${machineIds.join(', ')}`
    );
  }

  /**
   * Handle unsubscribe from machine updates
   */
  private handleUnsubscribe(ws: ExtendedWebSocket, message: UnsubscribeMessage): void {
    const machineIds = message.payload?.machineIds || [];
    machineIds.forEach((id) => {
      ws.client.subscribedMachines.delete(id);
    });

    this.sendTo(ws, {
      type: 'unsubscribed',
      timestamp: new Date().toISOString(),
      payload: {
        machineIds: Array.from(ws.client.subscribedMachines),
      },
    });
  }

  /**
   * Heartbeat check
   */
  private heartbeat(): void {
    this.clients.forEach((ws, id) => {
      if (!ws.client.isAlive) {
        console.log(`[WebSocket] Terminating inactive client: ${id}`);
        ws.terminate();
        this.clients.delete(id);
        return;
      }

      ws.client.isAlive = false;
      ws.ping();
    });
  }

  /**
   * Send message to specific client
   */
  sendTo(ws: ExtendedWebSocket, message: WsOutgoingMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(message: WsOutgoingMessage): void {
    this.clients.forEach((ws) => {
      this.sendTo(ws, message);
    });
  }

  /**
   * Broadcast to clients subscribed to a specific machine
   */
  broadcastToMachine(machineId: string, message: WsOutgoingMessage): void {
    this.clients.forEach((ws) => {
      if (ws.client.subscribedMachines.has(machineId) || ws.client.subscribedMachines.has('*')) {
        this.sendTo(ws, message);
      }
    });
  }

  /**
   * Broadcast to clients with specific roles
   */
  broadcastToRoles(roles: UserRole[], message: WsOutgoingMessage): void {
    this.clients.forEach((ws) => {
      if (roles.includes(ws.client.role)) {
        this.sendTo(ws, message);
      }
    });
  }

  /**
   * Send telemetry update to subscribed clients
   */
  sendTelemetry(machineId: string, data: unknown): void {
    this.broadcastToMachine(machineId, {
      type: 'telemetry',
      timestamp: new Date().toISOString(),
      payload: {
        machineId,
        data,
      },
    });
  }

  /**
   * Send alarm notification
   */
  sendAlarm(
    machineId: string,
    alarm: { alarmNo: number; alarmMsg: string; type: 'occurred' | 'cleared' }
  ): void {
    this.broadcastToMachine(machineId, {
      type: 'alarm',
      timestamp: new Date().toISOString(),
      payload: {
        machineId,
        ...alarm,
      },
    });
  }

  /**
   * Send scheduler update
   */
  sendSchedulerUpdate(machineId: string, data: unknown): void {
    this.broadcastToMachine(machineId, {
      type: 'scheduler',
      timestamp: new Date().toISOString(),
      payload: {
        machineId,
        data,
      },
    });
  }

  /**
   * Send M20 event (parts count increment)
   */
  sendM20Event(machineId: string, data: { programNo: string; count: number }): void {
    this.broadcastToMachine(machineId, {
      type: 'event',
      timestamp: new Date().toISOString(),
      payload: {
        machineId,
        eventType: 'M20_COMPLETE',
        ...data,
      },
    });
  }

  /**
   * Get connected clients count
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Get all connected clients info
   */
  getClients(): Array<{
    id: string;
    username: string;
    role: UserRole;
    subscribedMachines: string[];
  }> {
    return Array.from(this.clients.values()).map((ws) => ({
      id: ws.client.id,
      username: ws.client.username,
      role: ws.client.role,
      subscribedMachines: Array.from(ws.client.subscribedMachines),
    }));
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.clients.forEach((ws) => {
      ws.close(1001, 'Server shutting down');
    });
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    console.log('[WebSocket] Server shutdown');
  }
}

// Singleton instance
export const wsService = new WebSocketService();
export default wsService;

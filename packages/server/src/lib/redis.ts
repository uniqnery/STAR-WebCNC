// Redis Client Module
// Used for caching and pub/sub between server instances

import Redis from 'ioredis';
import { config } from '../config';

// Redis key prefixes
export const REDIS_KEYS = {
  // Session/Auth
  SESSION: (userId: string) => `session:${userId}`,
  BLACKLIST: (jti: string) => `blacklist:${jti}`,

  // Machine state cache
  MACHINE_STATE: (machineId: string) => `machine:${machineId}:state`,
  MACHINE_TELEMETRY: (machineId: string) => `machine:${machineId}:telemetry`,

  // Control lock
  CONTROL_LOCK: (machineId: string) => `control:lock:${machineId}`,

  // Scheduler
  SCHEDULER_JOB: (machineId: string) => `scheduler:job:${machineId}`,

  // Pub/Sub channels
  CHANNEL_TELEMETRY: 'channel:telemetry',
  CHANNEL_ALARM: 'channel:alarm',
  CHANNEL_EVENT: 'channel:event',
  CHANNEL_SCHEDULER: 'channel:scheduler',
} as const;

// Control lock data
export interface ControlLock {
  ownerId: string;
  ownerUsername: string;
  sessionId: string;
  acquiredAt: string;
  expiresAt: string;
}

class RedisService {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (this.client?.status === 'ready') {
      console.log('[Redis] Already connected');
      return;
    }

    const redisOptions = {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 10) {
          return null; // Stop retrying
        }
        return Math.min(times * 500, 3000);
      },
    };

    this.client = new Redis(config.redisUrl, redisOptions);
    this.subscriber = new Redis(config.redisUrl, redisOptions);
    this.publisher = new Redis(config.redisUrl, redisOptions);

    // Wait for all connections
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        this.client!.on('ready', () => {
          console.log('[Redis] Client connected');
          resolve();
        });
        this.client!.on('error', reject);
      }),
      new Promise<void>((resolve) => {
        this.subscriber!.on('ready', () => {
          console.log('[Redis] Subscriber connected');
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        this.publisher!.on('ready', () => {
          console.log('[Redis] Publisher connected');
          resolve();
        });
      }),
    ]);
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  /**
   * Set value in cache with optional TTL
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Delete key from cache
   */
  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }

  /**
   * Delete key from cache (alias for del)
   */
  async delete(key: string): Promise<void> {
    return this.del(key);
  }

  /**
   * Set key with expiration only if it doesn't exist (for locks)
   */
  async setNX(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    if (!this.client) return false;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const result = await this.client.set(key, serialized, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Acquire control lock for a machine
   */
  async acquireControlLock(
    machineId: string,
    ownerId: string,
    ownerUsername: string,
    sessionId: string,
    ttlSeconds: number = 300 // 5 minutes default
  ): Promise<boolean> {
    const lock: ControlLock = {
      ownerId,
      ownerUsername,
      sessionId,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };

    return this.setNX(REDIS_KEYS.CONTROL_LOCK(machineId), lock, ttlSeconds);
  }

  /**
   * Release control lock
   */
  async releaseControlLock(machineId: string, ownerId: string): Promise<boolean> {
    const lock = await this.get<ControlLock>(REDIS_KEYS.CONTROL_LOCK(machineId));
    if (!lock || lock.ownerId !== ownerId) {
      return false;
    }
    await this.del(REDIS_KEYS.CONTROL_LOCK(machineId));
    return true;
  }

  /**
   * Get current control lock
   */
  async getControlLock(machineId: string): Promise<ControlLock | null> {
    return this.get<ControlLock>(REDIS_KEYS.CONTROL_LOCK(machineId));
  }

  /**
   * Force release control lock (admin only)
   */
  async forceReleaseControlLock(machineId: string): Promise<void> {
    await this.del(REDIS_KEYS.CONTROL_LOCK(machineId));
  }

  /**
   * Extend control lock TTL
   */
  async extendControlLock(
    machineId: string,
    ownerId: string,
    additionalSeconds: number = 300
  ): Promise<boolean> {
    const lock = await this.get<ControlLock>(REDIS_KEYS.CONTROL_LOCK(machineId));
    if (!lock || lock.ownerId !== ownerId) {
      return false;
    }

    const newExpiry = new Date(Date.now() + additionalSeconds * 1000);
    lock.expiresAt = newExpiry.toISOString();

    await this.set(REDIS_KEYS.CONTROL_LOCK(machineId), lock, additionalSeconds);
    return true;
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string, handler: (message: string) => void): void {
    if (!this.subscriber) return;
    this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        handler(message);
      }
    });
  }

  /**
   * Publish message to channel
   */
  async publish(channel: string, message: unknown): Promise<void> {
    if (!this.publisher) return;
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);
    await this.publisher.publish(channel, serialized);
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    await Promise.all([
      this.client?.quit(),
      this.subscriber?.quit(),
      this.publisher?.quit(),
    ]);
    this.client = null;
    this.subscriber = null;
    this.publisher = null;
    console.log('[Redis] Disconnected');
  }

  /**
   * Check connection status
   */
  get isConnected(): boolean {
    return this.client?.status === 'ready';
  }
}

// Singleton instance
export const redisService = new RedisService();
export default redisService;

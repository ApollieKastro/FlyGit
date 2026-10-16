import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Thin Redis wrapper used for rate limiting, caches and BullMQ-ready workloads.
 * All operations degrade gracefully when Redis is unavailable — FlyGit must
 * keep serving requests even if the cache layer is down.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private available = false;

  async onModuleInit() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });
    this.client.on('ready', () => {
      this.available = true;
      this.logger.log('Redis connected');
    });
    this.client.on('error', (err) => {
      if (this.available) this.logger.warn(`Redis error: ${err.message}`);
      this.available = false;
    });
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async get(key: string): Promise<string | null> {
    if (!this.available || !this.client) return null;
    return this.client.get(key).catch(() => null);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.available || !this.client) return;
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds).catch(() => undefined);
    } else {
      await this.client.set(key, value).catch(() => undefined);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.available || !this.client) return;
    await this.client.del(key).catch(() => undefined);
  }

  /** Sliding-window counter used by rate limiting. Returns current count. */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    if (!this.available || !this.client) return 0;
    try {
      const count = await this.client.incr(key);
      if (count === 1) await this.client.expire(key, ttlSeconds);
      return count;
    } catch {
      return 0;
    }
  }

  /** Publish/subscribe helper for future worker fan-out. */
  async publish(channel: string, message: string): Promise<void> {
    if (!this.available || !this.client) return;
    await this.client.publish(channel, message).catch(() => undefined);
  }
}

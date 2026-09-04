import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export type RedisMessageHandler = (channel: string, message: string) => void | Promise<void>;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private subClient: Redis | null = null;
  private isConnected = false;
  private isSubConnected = false;
  private readonly messageHandlers = new Map<string, Set<RedisMessageHandler>>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get<string>('redis.host', 'localhost');
    const port = this.configService.get<number>('redis.port', 6379);

    try {
      this.client = new Redis({
        host,
        port,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.warn('Redis retry limit exceeded, operating in database fallback mode');
            return null;
          }
          return Math.min(times * 100, 2000);
        },
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });

      await this.client.connect();
      this.isConnected = true;
      this.logger.log(`Connected to Redis at ${host}:${port}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis connection failed: ${message}. Operating in fail-secure DB fallback mode.`);
      this.isConnected = false;
    }

    try {
      this.subClient = new Redis({
        host,
        port,
        retryStrategy: (times) => {
          return Math.min(times * 200, 3000);
        },
        lazyConnect: true,
      });

      this.subClient.on('message', (channel, message) => {
        const handlers = this.messageHandlers.get(channel);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(channel, message);
            } catch (handlerErr: unknown) {
              const msg = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
              this.logger.error(`Error in Redis subscriber handler for ${channel}: ${msg}`);
            }
          }
        }
      });

      this.subClient.on('connect', () => {
        this.isSubConnected = true;
        this.logger.log(`Redis subscriber connected at ${host}:${port}`);
        // Re-subscribe to existing channels on reconnect
        for (const channel of this.messageHandlers.keys()) {
          this.subClient?.subscribe(channel).catch(() => {});
        }
      });

      this.subClient.on('close', () => {
        this.isSubConnected = false;
      });

      await this.subClient.connect();
      this.isSubConnected = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis subscriber connection failed: ${message}`);
      this.isSubConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.subClient) {
      await this.subClient.quit().catch(() => {});
    }
    if (this.client) {
      await this.client.quit().catch(() => {});
    }
  }

  async subscribe(channel: string, handler: RedisMessageHandler): Promise<void> {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, new Set<RedisMessageHandler>());
      if (this.subClient && this.isSubConnected) {
        try {
          await this.subClient.subscribe(channel);
          this.logger.log(`Subscribed to Redis channel: ${channel}`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to subscribe to ${channel}: ${message}`);
        }
      }
    }
    this.messageHandlers.get(channel)!.add(handler);
  }

  async unsubscribe(channel: string, handler: RedisMessageHandler): Promise<void> {
    const handlers = this.messageHandlers.get(channel);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.messageHandlers.delete(channel);
        if (this.subClient && this.isSubConnected) {
          await this.subClient.unsubscribe(channel).catch(() => {});
        }
      }
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number = 86400): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to set Redis key ${key}: ${message}`);
    }
  }

  async isRevoked(key: string): Promise<boolean | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }
    try {
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch {
      return null;
    }
  }

  async setRevocation(key: string, ttlSeconds: number = 900): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    try {
      await this.client.set(key, 'revoked', 'EX', ttlSeconds);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to set Redis revocation for ${key}: ${message}`);
    }
  }

  async incrRateLimit(key: string, windowSeconds: number): Promise<number> {
    if (!this.client || !this.isConnected) {
      return 1; // Allow if Redis is unavailable
    }
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, windowSeconds);
      }
      return count;
    } catch {
      return 1;
    }
  }

  async resetRateLimit(key: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    try {
      await this.client.del(key);
    } catch {}
  }

  async publish(channel: string, message: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    try {
      await this.client.publish(channel, message);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to publish Redis message to ${channel}: ${message}`);
    }
  }
}

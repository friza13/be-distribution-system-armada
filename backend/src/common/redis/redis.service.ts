import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    try {
      const host = this.configService.get<string>('redis.host', 'localhost');
      const port = this.configService.get<number>('redis.port', 6379);

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
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  async isRevoked(key: string): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false; // Fallback will check DB
    }
    try {
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch {
      return false;
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

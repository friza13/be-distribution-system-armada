import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { StorageHealthIndicator } from './indicators/storage-health.indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prismaService: PrismaService,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly storageIndicator: StorageHealthIndicator,
    private readonly memoryIndicator: MemoryHealthIndicator,
  ) {}

  @Get('liveness')
  getLiveness() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readiness')
  @HealthCheck()
  getReadiness() {
    return this.health.check([
      // 1. PostgreSQL DB Ping
      () => this.prismaIndicator.pingCheck('database', this.prismaService),

      // 2. Redis Cache Ping
      () => this.redisIndicator.isHealthy('redis'),

      // 3. POD Storage Accessibility
      () => this.storageIndicator.isHealthy('storage'),

      // 4. Memory Heap Check (Cap at 1024MB heap threshold)
      () => this.memoryIndicator.checkHeap('memory_heap', 1024 * 1024 * 1024),
    ]);
  }
}

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { StorageHealthIndicator } from './indicators/storage-health.indicator';

@Module({
  imports: [TerminusModule, PrismaModule, RedisModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, StorageHealthIndicator],
})
export class HealthModule {}

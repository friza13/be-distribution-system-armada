import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { RedisService } from '../../../common/redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Perform ping/check on Redis
      const pingResult = await this.redisService.incrRateLimit('health:readiness:ping', 1);
      const isOk = pingResult >= 1;
      const result = this.getStatus(key, isOk);

      if (isOk) {
        return result;
      }
      throw new HealthCheckError('Redis health check failed', result);
    } catch (err: unknown) {
      const result = this.getStatus(key, false, {
        message: err instanceof Error ? err.message : String(err),
      });
      throw new HealthCheckError('Redis health check failed', result);
    }
  }
}

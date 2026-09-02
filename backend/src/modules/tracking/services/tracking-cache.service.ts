import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../common/redis/redis.service';

export interface CachedLocationData {
  driverId: string;
  deliveryId?: string | null;
  latitude: number;
  longitude: number;
  accuracyM: number;
  speedMps?: number | null;
  headingDeg?: number | null;
  recordedAt: string;
  receivedAt: string;
}

@Injectable()
export class TrackingCacheService {
  private readonly logger = new Logger(TrackingCacheService.name);
  private readonly cacheTtlSeconds = 86400; // 24 hours

  constructor(private readonly redisService: RedisService) {}

  /**
   * Updates latest location in Redis cache with Out-of-Order protection.
   * Only updates if cache miss OR new.recordedAt > cached.recordedAt.
   */
  async setLatestLocation(
    driverId: string,
    payload: CachedLocationData,
  ): Promise<boolean> {
    if (!driverId || !payload) {
      return false;
    }

    const key = `driver:location:latest:${driverId}`;

    try {
      // 1. Fetch current cached location
      const existingRaw = await this.redisService.get(key);

      if (existingRaw) {
        try {
          const cached: CachedLocationData = JSON.parse(existingRaw);
          if (cached && cached.recordedAt) {
            const cachedTime = new Date(cached.recordedAt).getTime();
            const newTime = new Date(payload.recordedAt).getTime();

            // Out-of-Order Protection: If new location is NOT strictly newer, skip cache update
            if (!isNaN(cachedTime) && !isNaN(newTime) && newTime <= cachedTime) {
              this.logger.debug(
                `Out-of-order GPS packet ignored for Redis cache update (driver ${driverId}): new ${payload.recordedAt} <= cached ${cached.recordedAt}`,
              );
              return false;
            }
          }
        } catch (parseErr) {
          // If cached data is malformed JSON, proceed with overwrite
          this.logger.warn(`Malformed cached location JSON for key ${key}, overwriting.`);
        }
      }

      // 2. Set new latest location with TTL 24h
      await this.redisService.set(key, JSON.stringify(payload), this.cacheTtlSeconds);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to update Redis latest location for driver ${driverId}: ${message}`);
      return false;
    }
  }

  /**
   * Fetches latest cached location for a driver.
   */
  async getLatestLocation(driverId: string): Promise<CachedLocationData | null> {
    if (!driverId) return null;
    const key = `driver:location:latest:${driverId}`;
    try {
      const raw = await this.redisService.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CachedLocationData;
    } catch {
      return null;
    }
  }
}

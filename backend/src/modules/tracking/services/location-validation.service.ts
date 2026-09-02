import { Injectable, Logger } from '@nestjs/common';
import { LocationIngestionDto } from '../dto/location-ingestion.dto';
import { RedisService } from '../../../common/redis/redis.service';
import {
  validateCoordinateBounds,
  validateAccuracyThreshold,
  validateClockSkew,
  calculateImpliedSpeedMps,
  isVelocityAnomaly,
} from '../utils/gps-validator.util';

export type ValidationStatus = 'VALID' | 'ANOMALY_VELOCITY' | 'REJECTED';

export interface LocationValidationResult {
  valid: boolean;
  status: ValidationStatus;
  reason?: string;
  calculatedSpeedMps?: number;
}

@Injectable()
export class LocationValidationService {
  private readonly logger = new Logger(LocationValidationService.name);

  constructor(private readonly redisService: RedisService) {}

  async validateSinglePoint(
    dto: LocationIngestionDto,
    driverId: string,
    receivedAt: Date = new Date(),
  ): Promise<LocationValidationResult> {
    // 1. DTO / Coordinate Bounds Check (-90 <= lat <= 90, -180 <= lng <= 180)
    if (!validateCoordinateBounds(dto.latitude, dto.longitude)) {
      return {
        valid: false,
        status: 'REJECTED',
        reason: 'INVALID_COORDINATES',
      };
    }

    // 2. Accuracy Threshold Check (accuracyM <= 50m)
    if (!validateAccuracyThreshold(dto.accuracyM, 50)) {
      return {
        valid: false,
        status: 'REJECTED',
        reason: 'GPS_ACCURACY_BELOW_THRESHOLD',
      };
    }

    // 3. Clock Skew Check (-1 hour <= recordedAt <= receivedAt + 5 min)
    const clockSkew = validateClockSkew(dto.recordedAt, receivedAt);
    if (!clockSkew.valid) {
      return {
        valid: false,
        status: 'REJECTED',
        reason: clockSkew.reason || 'TIMESTAMP_INVALID',
      };
    }

    // 4. Velocity Anomaly Detection against Redis cached previous location
    let calculatedSpeedMps: number | undefined;
    try {
      const cachedRaw = await this.redisService.get(`driver:location:latest:${driverId}`);
      if (cachedRaw) {
        const prevLocation = JSON.parse(cachedRaw);
        if (
          prevLocation &&
          typeof prevLocation.latitude === 'number' &&
          typeof prevLocation.longitude === 'number' &&
          prevLocation.recordedAt
        ) {
          const tPrev = new Date(prevLocation.recordedAt).getTime();
          const tNew = new Date(dto.recordedAt).getTime();

          // Only calculate velocity if new point is strictly newer in time
          if (tNew > tPrev) {
            calculatedSpeedMps = calculateImpliedSpeedMps(
              prevLocation.latitude,
              prevLocation.longitude,
              prevLocation.recordedAt,
              dto.latitude,
              dto.longitude,
              dto.recordedAt,
            );

            if (isVelocityAnomaly(calculatedSpeedMps, 41.67)) {
              // 41.67 m/s = 150 km/h
              this.logger.warn(
                `Velocity anomaly detected for driver ${driverId}: implied speed ${calculatedSpeedMps.toFixed(2)} m/s (>150 km/h)`,
              );
              return {
                valid: true, // Saved to DB for audit, but flagged as anomaly
                status: 'ANOMALY_VELOCITY',
                reason: 'VELOCITY_EXCEEDS_PLAUSIBLE_LIMIT',
                calculatedSpeedMps,
              };
            }
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to evaluate previous Redis location for velocity check: ${message}`);
    }

    return {
      valid: true,
      status: 'VALID',
      calculatedSpeedMps,
    };
  }
}

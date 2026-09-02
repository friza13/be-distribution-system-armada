import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { LocationIngestionDto } from '../../src/modules/tracking/dto/location-ingestion.dto';
import { LocationBatchIngestionDto } from '../../src/modules/tracking/dto/location-batch-ingestion.dto';
import {
  validateCoordinateBounds,
  validateAccuracyThreshold,
  validateClockSkew,
  calculateImpliedSpeedMps,
  isVelocityAnomaly,
  haversineDistanceMeters,
} from '../../src/modules/tracking/utils/gps-validator.util';
import { LocationValidationService } from '../../src/modules/tracking/services/location-validation.service';

describe('GPS Telemetry Validation Pipeline (Unit Tests)', () => {
  let validationService: LocationValidationService;
  let mockRedisService: any;

  beforeEach(() => {
    mockRedisService = {
      get: jest.fn(),
    };
    validationService = new LocationValidationService(mockRedisService);
  });

  describe('1. Coordinate Bounds Validation', () => {
    it('should pass valid latitude and longitude coordinates', () => {
      expect(validateCoordinateBounds(-6.20012, 106.8162)).toBe(true);
      expect(validateCoordinateBounds(0, 0)).toBe(true);
      expect(validateCoordinateBounds(-90, -180)).toBe(true);
      expect(validateCoordinateBounds(90, 180)).toBe(true);
    });

    it('should reject latitude > 90', () => {
      expect(validateCoordinateBounds(90.1, 106.8162)).toBe(false);
    });

    it('should reject latitude < -90', () => {
      expect(validateCoordinateBounds(-90.0001, 106.8162)).toBe(false);
    });

    it('should reject longitude > 180', () => {
      expect(validateCoordinateBounds(-6.20012, 180.0001)).toBe(false);
    });

    it('should reject longitude < -180', () => {
      expect(validateCoordinateBounds(-6.20012, -180.5)).toBe(false);
    });

    it('should reject non-numeric, NaN, or Infinity coordinates', () => {
      expect(validateCoordinateBounds(NaN, 106.8)).toBe(false);
      expect(validateCoordinateBounds(-6.2, Infinity)).toBe(false);
      expect(validateCoordinateBounds('abc' as any, 106.8)).toBe(false);
    });
  });

  describe('2. Accuracy Threshold Validation', () => {
    it('should pass accuracy <= 50 meters', () => {
      expect(validateAccuracyThreshold(5.0)).toBe(true);
      expect(validateAccuracyThreshold(50.0)).toBe(true);
    });

    it('should reject accuracy > 50 meters', () => {
      expect(validateAccuracyThreshold(50.1)).toBe(false);
      expect(validateAccuracyThreshold(100)).toBe(false);
    });

    it('should reject accuracy <= 0 or invalid numbers', () => {
      expect(validateAccuracyThreshold(0)).toBe(false);
      expect(validateAccuracyThreshold(-5)).toBe(false);
      expect(validateAccuracyThreshold(NaN)).toBe(false);
    });
  });

  describe('3. Clock Skew & Timestamp Validation', () => {
    const now = new Date('2026-09-02T10:00:00.000Z');

    it('should pass valid timestamp within acceptable window', () => {
      const recordedAt = new Date('2026-09-02T09:55:00.000Z').toISOString();
      const res = validateClockSkew(recordedAt, now);
      expect(res.valid).toBe(true);
    });

    it('should reject future timestamp (> 5 minutes ahead)', () => {
      const futureAt = new Date('2026-09-02T10:06:00.000Z').toISOString();
      const res = validateClockSkew(futureAt, now);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('TIMESTAMP_FUTURE');
    });

    it('should reject stale timestamp (> 1 hour ago)', () => {
      const staleAt = new Date('2026-09-02T08:59:59.000Z').toISOString();
      const res = validateClockSkew(staleAt, now);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('TIMESTAMP_STALE');
    });

    it('should reject invalid date strings', () => {
      const res = validateClockSkew('invalid-date-string', now);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('TIMESTAMP_INVALID');
    });
  });

  describe('4. Geodesic Distance & Velocity Anomaly Calculation', () => {
    it('should calculate Haversine distance between two points correctly', () => {
      // Distance between Monas (-6.1754, 106.8272) and Bundaran HI (-6.1950, 106.8230) is ~2.2 km
      const distM = haversineDistanceMeters(-6.1754, 106.8272, -6.1950, 106.8230);
      expect(distM).toBeGreaterThan(2100);
      expect(distM).toBeLessThan(2300);
    });

    it('should calculate plausible velocity (<150 km/h = <41.67 m/s)', () => {
      // 100 meters in 10 seconds = 10 m/s (36 km/h)
      const speed = calculateImpliedSpeedMps(
        -6.2000,
        106.8160,
        '2026-09-02T10:00:00Z',
        -6.2009,
        106.8160,
        '2026-09-02T10:00:10Z',
      );
      expect(speed).toBeGreaterThan(9);
      expect(speed).toBeLessThan(11);
      expect(isVelocityAnomaly(speed)).toBe(false);
    });

    it('should detect implausible velocity anomaly (>150 km/h = >41.67 m/s)', () => {
      // 10 km jump in 10 seconds = 1000 m/s (3600 km/h)
      const speed = calculateImpliedSpeedMps(
        -6.2000,
        106.8160,
        '2026-09-02T10:00:00Z',
        -6.3000,
        106.8160,
        '2026-09-02T10:00:10Z',
      );
      expect(isVelocityAnomaly(speed)).toBe(true);
    });

    it('should handle equal timestamps or out-of-order points safely without division by zero', () => {
      const speedEqual = calculateImpliedSpeedMps(
        -6.2000,
        106.8160,
        '2026-09-02T10:00:00Z',
        -6.2009,
        106.8160,
        '2026-09-02T10:00:00Z',
      );
      expect(speedEqual).toBe(0);

      const speedOutOfOrder = calculateImpliedSpeedMps(
        -6.2000,
        106.8160,
        '2026-09-02T10:00:10Z',
        -6.2009,
        106.8160,
        '2026-09-02T10:00:00Z',
      );
      expect(speedOutOfOrder).toBe(0);
    });
  });

  describe('5. LocationValidationService Integration', () => {
    const driverId = 'drv-12345';
    const now = new Date('2026-09-02T10:00:00.000Z');

    it('should validate cold start point (no previous cache) as VALID', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const dto: LocationIngestionDto = {
        latitude: -6.20012,
        longitude: 106.8162,
        accuracyM: 10,
        recordedAt: '2026-09-02T09:59:50.000Z',
      };

      const res = await validationService.validateSinglePoint(dto, driverId, now);
      expect(res.valid).toBe(true);
      expect(res.status).toBe('VALID');
    });

    it('should flag velocity anomaly point as ANOMALY_VELOCITY (valid=true for DB, but flagged)', async () => {
      // Previous cached location 10km away 10 seconds ago
      const cached = JSON.stringify({
        latitude: -6.1000,
        longitude: 106.8162,
        recordedAt: '2026-09-02T09:59:40.000Z',
      });
      mockRedisService.get.mockResolvedValue(cached);

      const dto: LocationIngestionDto = {
        latitude: -6.2000,
        longitude: 106.8162,
        accuracyM: 10,
        recordedAt: '2026-09-02T09:59:50.000Z',
      };

      const res = await validationService.validateSinglePoint(dto, driverId, now);
      expect(res.valid).toBe(true);
      expect(res.status).toBe('ANOMALY_VELOCITY');
      expect(res.reason).toBe('VELOCITY_EXCEEDS_PLAUSIBLE_LIMIT');
      expect(res.calculatedSpeedMps).toBeGreaterThan(41.67);
    });

    it('should reject invalid coordinates fundamental failure', async () => {
      const dto: LocationIngestionDto = {
        latitude: 95, // Invalid lat > 90
        longitude: 106.8162,
        accuracyM: 10,
        recordedAt: '2026-09-02T09:59:50.000Z',
      };

      const res = await validationService.validateSinglePoint(dto, driverId, now);
      expect(res.valid).toBe(false);
      expect(res.status).toBe('REJECTED');
      expect(res.reason).toBe('INVALID_COORDINATES');
    });
  });

  describe('6. Class Validator DTO Rules', () => {
    it('should pass valid Single LocationIngestionDto plain object', async () => {
      const plain = {
        latitude: -6.20012,
        longitude: 106.8162,
        accuracyM: 8.5,
        recordedAt: new Date().toISOString(),
        speedMps: 12.5,
        headingDeg: 180,
      };

      const dto = plainToInstance(LocationIngestionDto, plain);
      await expect(validateOrReject(dto)).resolves.toBeUndefined();
    });

    it('should reject invalid heading > 360 or speed < 0', async () => {
      const plainInvalid = {
        latitude: -6.20012,
        longitude: 106.8162,
        accuracyM: 8.5,
        recordedAt: new Date().toISOString(),
        speedMps: -5, // Invalid negative speed
        headingDeg: 400, // Invalid heading > 360
      };

      const dto = plainToInstance(LocationIngestionDto, plainInvalid);
      await expect(validateOrReject(dto)).rejects.toBeDefined();
    });

    it('should pass LocationBatchIngestionDto with 1 to 50 points', async () => {
      const plainBatch = {
        points: [
          {
            latitude: -6.20012,
            longitude: 106.8162,
            accuracyM: 8.5,
            recordedAt: new Date().toISOString(),
          },
        ],
      };

      const batchDto = plainToInstance(LocationBatchIngestionDto, plainBatch);
      await expect(validateOrReject(batchDto)).resolves.toBeUndefined();
    });

    it('should reject LocationBatchIngestionDto with 0 points or > 50 points', async () => {
      const emptyBatch = plainToInstance(LocationBatchIngestionDto, { points: [] });
      await expect(validateOrReject(emptyBatch)).rejects.toBeDefined();

      const array51 = Array(51).fill({
        latitude: -6.20012,
        longitude: 106.8162,
        accuracyM: 8.5,
        recordedAt: new Date().toISOString(),
      });

      const oversizedBatch = plainToInstance(LocationBatchIngestionDto, { points: array51 });
      await expect(validateOrReject(oversizedBatch)).rejects.toBeDefined();
    });
  });
});

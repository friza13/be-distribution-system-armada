import {
  Injectable,
  ForbiddenException,
  UnprocessableEntityException,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LocationValidationService } from './location-validation.service';
import { TrackingCacheService } from './tracking-cache.service';
import { RealtimeGateway } from '../../realtime/gateways/realtime.gateway';
import { formatRealtimeEvent } from '../../realtime/dto/realtime-envelope.dto';
import { LocationIngestionDto } from '../dto/location-ingestion.dto';
import { LocationBatchIngestionDto } from '../dto/location-batch-ingestion.dto';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export interface TelemetryIngestionResult {
  locationId: string;
  validationStatus: string;
  receivedAt: Date;
  idempotent?: boolean;
}

export interface BatchIngestionResult {
  accepted: number;
  rejected: number;
  errors: Array<{ index: number; code: string; recordedAt?: string }>;
  latestBroadcast?: {
    latitude: number;
    longitude: number;
    recordedAt: string;
  };
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly locationValidationService: LocationValidationService,
    private readonly trackingCacheService: TrackingCacheService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  /**
   * Single Telemetry Processing Pipeline (Shared by REST & WS)
   */
  async processTelemetry(
    dto: LocationIngestionDto,
    driverId: string,
    userRole: string,
    receivedAt: Date = new Date(),
    endpoint: string = '/v1/me/location',
    skipSingleRateLimit: boolean = false,
  ): Promise<TelemetryIngestionResult> {
    // 1. Role Enforcement (Only DRIVER role permitted)
    if (userRole !== 'DRIVER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only drivers are authorized to submit location telemetry',
      });
    }

    if (!driverId) {
      throw new ForbiddenException({
        code: 'DRIVER_PROFILE_REQUIRED',
        message: 'Authenticated user does not have an associated driver profile',
      });
    }

    // 2. Anti-Spoofing: If client body includes deliveryId, verify delivery ownership
    if (dto.deliveryId) {
      const delivery = await this.prisma.delivery.findUnique({
        where: { id: dto.deliveryId },
        select: { id: true, driverId: true },
      });

      if (!delivery) {
        throw new UnprocessableEntityException({
          code: 'DELIVERY_NOT_FOUND',
          message: `Delivery ${dto.deliveryId} does not exist`,
        });
      }

      if (delivery.driverId !== driverId) {
        this.logger.warn(
          `Anti-IDOR rejection: Driver ${driverId} attempted to submit telemetry for delivery ${dto.deliveryId} assigned to driver ${delivery.driverId}`,
        );
        throw new ForbiddenException({
          code: 'DELIVERY_NOT_ASSIGNED_TO_DRIVER',
          message: 'Delivery is not assigned to the authenticated driver',
        });
      }
    }

    // 3. Race-Safe Idempotency Check via PostgreSQL Unique Constraint @@unique([key, userId, endpoint])
    if (dto.idempotencyKey) {
      const user = await this.prisma.driver.findUnique({
        where: { id: driverId },
        select: { userId: true },
      });

      if (user) {
        const existingRecord = await this.prisma.idempotencyRecord.findUnique({
          where: {
            key_userId_endpoint: {
              key: dto.idempotencyKey,
              userId: user.userId,
              endpoint,
            },
          },
        });

        if (existingRecord) {
          const body = existingRecord.responseBody as any;
          return {
            locationId: body?.locationId || uuidv4(),
            validationStatus: body?.validationStatus || 'VALID',
            receivedAt: new Date(body?.receivedAt || Date.now()),
            idempotent: true,
          };
        }
      }
    }

    // 4. Rate Limiting: Max 1 request per second per driver (Skipped during batch ingestion)
    if (!skipSingleRateLimit) {
      const rateCount = await this.redisService.incrRateLimit(
        `throttle:location:driver:${driverId}`,
        1,
      );
      if (rateCount > 1) {
        throw new HttpException(
          {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Telemetry ingestion rate limit exceeded (Max 1 req/sec). Please slow down.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // 5. Validation Pipeline (Bounds, Accuracy <= 50m, Clock Skew, Velocity Anomaly)
    const valResult = await this.locationValidationService.validateSinglePoint(
      dto,
      driverId,
      receivedAt,
    );

    if (!valResult.valid) {
      throw new UnprocessableEntityException({
        code: valResult.reason || 'GPS_VALIDATION_FAILED',
        message: `GPS telemetry rejected: ${valResult.reason}`,
      });
    }

    // 6. Persistence to PostGIS location_points
    const locationId = uuidv4();
    const recordedAtDate = new Date(dto.recordedAt);

    await this.prisma.$executeRaw`
      INSERT INTO location_points (
        id, driver_id, delivery_id, latitude, longitude,
        geom, accuracy_m, speed_mps, heading_deg,
        recorded_at, received_at, source, validation_status
      ) VALUES (
        ${locationId}::uuid,
        ${driverId}::uuid,
        ${dto.deliveryId ? dto.deliveryId : null}::uuid,
        ${dto.latitude},
        ${dto.longitude},
        ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326),
        ${dto.accuracyM},
        ${dto.speedMps !== undefined ? dto.speedMps : null},
        ${dto.headingDeg !== undefined ? dto.headingDeg : null},
        ${recordedAtDate},
        ${receivedAt},
        'driver_app',
        ${valResult.status}
      )
    `;

    const result: TelemetryIngestionResult = {
      locationId,
      validationStatus: valResult.status,
      receivedAt,
    };

    // 7. Save Idempotency Record (if idempotencyKey provided)
    if (dto.idempotencyKey) {
      const user = await this.prisma.driver.findUnique({
        where: { id: driverId },
        select: { userId: true },
      });

      if (user) {
        try {
          await this.prisma.idempotencyRecord.create({
            data: {
              key: dto.idempotencyKey,
              userId: user.userId,
              endpoint,
              responseStatus: 201,
              responseBody: result as unknown as Prisma.InputJsonValue,
              expiresAt: new Date(Date.now() + 24 * 3600 * 1000), // 24 hours
            },
          });
        } catch (err: unknown) {
          // Catch race-condition P2002 if concurrent duplicate request beat us
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            this.logger.debug(`Idempotency race collision caught for key ${dto.idempotencyKey}`);
          }
        }
      }
    }

    // 8. Update Redis Latest Location Cache (With Out-of-Order protection)
    await this.trackingCacheService.setLatestLocation(driverId, {
      driverId,
      deliveryId: dto.deliveryId || null,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyM: dto.accuracyM,
      speedMps: dto.speedMps || null,
      headingDeg: dto.headingDeg || null,
      recordedAt: dto.recordedAt,
      receivedAt: receivedAt.toISOString(),
    });

    // 9. Realtime Broadcast (ONLY for VALID points, NOT for ANOMALY_VELOCITY)
    if (valResult.status === 'VALID' && this.realtimeGateway && this.realtimeGateway.server) {
      const user = await this.prisma.driver.findUnique({
        where: { id: driverId },
        select: { userId: true, user: { select: { role: { select: { code: true } } } } },
      });

      const envelope = formatRealtimeEvent(
        'driver.location.updated',
        {
          driverId,
          deliveryId: dto.deliveryId || null,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyM: dto.accuracyM,
          speedMps: dto.speedMps || null,
          headingDeg: dto.headingDeg || null,
          recordedAt: dto.recordedAt,
          receivedAt: receivedAt.toISOString(),
        },
        {
          userId: user?.userId || 'unknown',
          role: user?.user?.role?.code || 'DRIVER',
          deviceId: undefined,
          driverId,
        },
      );

      // Broadcast to room 'fleet:monitoring'
      this.realtimeGateway.server.to('fleet:monitoring').emit('driver.location.updated', envelope);

      // Broadcast to room 'delivery:<id>' if assigned to active delivery
      if (dto.deliveryId) {
        this.realtimeGateway.server
          .to(`delivery:${dto.deliveryId}`)
          .emit('driver.location.updated', envelope);
      }
    }

    return result;
  }

  /**
   * Batch Offline Outbox Ingestion (Max 50 points per batch, 1 batch/min limit)
   */
  async processBatch(
    batchDto: LocationBatchIngestionDto,
    driverId: string,
    userRole: string,
    receivedAt: Date = new Date(),
  ): Promise<BatchIngestionResult> {
    if (userRole !== 'DRIVER' || !driverId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only drivers are authorized to submit location telemetry',
      });
    }

    // Rate Limit: 1 batch per 60 seconds per driver
    const rateCount = await this.redisService.incrRateLimit(
      `throttle:location:batch:driver:${driverId}`,
      60,
    );
    if (rateCount > 1) {
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Batch telemetry rate limit exceeded (Max 1 batch/min).',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const accepted: TelemetryIngestionResult[] = [];
    const rejected: Array<{ index: number; code: string; recordedAt?: string }> = [];

    // Process each point in batch sequentially
    for (let i = 0; i < batchDto.points.length; i++) {
      const dto = batchDto.points[i];
      try {
        const res = await this.processTelemetry(
          dto,
          driverId,
          userRole,
          receivedAt,
          '/v1/me/location/batch',
          true, // Skip 1 req/sec rate limit during batch loop
        );
        accepted.push(res);
      } catch (err: unknown) {
        let code = 'GPS_VALIDATION_FAILED';
        if (err instanceof HttpException) {
          const resp = err.getResponse() as any;
          code = resp?.code || err.message;
        }
        rejected.push({
          index: i,
          code,
          recordedAt: dto.recordedAt,
        });
      }
    }

    // Find the latest accepted valid point for broadcast hint
    let latestBroadcast: { latitude: number; longitude: number; recordedAt: string } | undefined;
    if (accepted.length > 0) {
      const validPoints = batchDto.points.filter((_, idx: number) =>
        accepted.some((acc, aIdx: number) => aIdx === idx && acc.validationStatus === 'VALID'),
      );
      if (validPoints.length > 0) {
        validPoints.sort(
          (a: LocationIngestionDto, b: LocationIngestionDto) =>
            new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
        );
        latestBroadcast = {
          latitude: validPoints[0].latitude,
          longitude: validPoints[0].longitude,
          recordedAt: validPoints[0].recordedAt,
        };
      }
    }

    return {
      accepted: accepted.length,
      rejected: rejected.length,
      errors: rejected,
      latestBroadcast,
    };
  }
}

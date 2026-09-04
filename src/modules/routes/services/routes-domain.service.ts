import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { RouteOptimizerService } from './route-optimizer.service';
import { RealtimeGateway } from '../../realtime/gateways/realtime.gateway';
import { formatRealtimeEvent } from '../../realtime/dto/realtime-envelope.dto';
import { RecommendRouteDto } from '../dto/recommend-route.dto';
import { SelectRouteDto } from '../dto/select-route.dto';
import { ManualReorderDto } from '../dto/manual-reorder.dto';
import { Waypoint } from '../interfaces/routing-provider.interface';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export interface RouteActor {
  userId: string;
  role: string;
  driverId: string | null;
}

@Injectable()
export class RoutesDomainService {
  private readonly logger = new Logger(RoutesDomainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly routeOptimizerService: RouteOptimizerService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  private readonly TERMINAL_DELIVERY_STATUSES = ['COMPLETED', 'CANCELLED', 'FAILED'];

  private ensureDeliveryOperational(status: string): void {
    if (this.TERMINAL_DELIVERY_STATUSES.includes(status)) {
      throw new ConflictException({
        code: 'INVALID_DELIVERY_STATE',
        message: `Cannot mutate route while delivery is in terminal state ${status}`,
      });
    }
  }

  /**
   * Verified Delivery Ownership Guard (Anti-IDOR Defense)
   */
  async verifyDeliveryAccess(deliveryId: string, actor: RouteActor) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        driver: true,
      },
    });

    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: `Delivery with ID ${deliveryId} not found`,
      });
    }

    // Role-based object authorization.
    if (actor.role === 'DRIVER' && (!actor.driverId || delivery.driverId !== actor.driverId)) {
      this.logger.warn(
        `Anti-IDOR rejection: Driver ${actor.driverId || actor.userId} attempted to access delivery ${deliveryId} assigned to driver ${delivery.driverId}`,
      );
      throw new ForbiddenException({
        code: 'RESOURCE_FORBIDDEN',
        message: 'You are not assigned to this delivery',
      });
    }
    if (actor.role === 'OWNER' && delivery.createdBy !== actor.userId) {
      throw new ForbiddenException({
        code: 'RESOURCE_FORBIDDEN',
        message: 'You are not authorized to access this delivery',
      });
    }

    return delivery;
  }

  /**
   * Rate Limit: Max 5 route requests / 60s per deliveryId to prevent Algorithmic DoS
   */
  private async enforceRouteRateLimit(deliveryId: string): Promise<void> {
    const rateCount = await this.redisService.incrRateLimit(
      `throttle:route:delivery:${deliveryId}`,
      60,
    );
    if (rateCount > 5) {
      throw new HttpException(
        {
          code: 'ROUTE_RATE_LIMIT_EXCEEDED',
          message: 'Route optimization rate limit exceeded (Max 5 req/min per delivery).',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * POST /v1/deliveries/:id/routes/recommend
   */
  async recommendRoute(
    deliveryId: string,
    dto: RecommendRouteDto,
    actor: RouteActor,
  ) {
    const delivery = await this.verifyDeliveryAccess(deliveryId, actor);
    this.ensureDeliveryOperational(delivery.status);
    await this.enforceRouteRateLimit(deliveryId);

    if (!delivery.stops || delivery.stops.length === 0) {
      throw new UnprocessableEntityException({
        code: 'DELIVERY_NO_STOPS',
        message: 'Delivery has no stops to optimize',
      });
    }

    // Convert delivery_stops to Waypoints
    const waypoints: Waypoint[] = delivery.stops.map((stop: any) => ({
      id: stop.id,
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
    }));

    // Perform Optimization (N<=5 Exhaustive Permutation / N>5 2-Opt)
    const optimizationResult = await this.routeOptimizerService.optimizeRoute(
      waypoints,
      dto?.provider,
      true, // Fixed origin
    );

    const recommendedSequence = optimizationResult.sequenceMap.map((s: any) => {
      const stop = delivery.stops.find((st: any) => st.id === s.deliveryStopId);
      return {
        sequence: s.sequence,
        deliveryStopId: s.deliveryStopId,
        destinationName: stop ? stop.destinationName : '',
      };
    });

    return {
      deliveryId: delivery.id,
      algorithm: optimizationResult.algorithm,
      providerUsed: optimizationResult.providerUsed,
      totalDistanceMeters: optimizationResult.totalDistanceM,
      estimatedDurationSeconds: optimizationResult.estimatedDurationS,
      recommendedSequence,
      polylineGeojson: optimizationResult.geometry?.polylineGeojson || null,
    };
  }

  /**
   * POST /v1/deliveries/:id/routes/select
   */
  async selectRoute(
    deliveryId: string,
    dto: SelectRouteDto,
    actor: RouteActor,
    endpoint: string = '/v1/deliveries/:id/routes/select',
  ) {
    const delivery = await this.verifyDeliveryAccess(deliveryId, actor);
    this.ensureDeliveryOperational(delivery.status);
    await this.enforceRouteRateLimit(deliveryId);

    // Race-Safe Idempotency Check
    if (dto.idempotencyKey) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: {
          key_userId_endpoint: {
            key: dto.idempotencyKey,
            userId: actor.userId,
            endpoint,
          },
        },
      });

      if (existing) {
        return {
          ...(existing.responseBody as any),
          idempotent: true,
        };
      }
    }

    // Verify all recommended stop IDs belong to this delivery
    const deliveryStopIds = new Set(delivery.stops.map((s: any) => s.id));
    for (const stopId of dto.recommendedSequence) {
      if (!deliveryStopIds.has(stopId)) {
        throw new UnprocessableEntityException({
          code: 'INVALID_STOP_ID',
          message: `Stop ID ${stopId} does not belong to delivery ${deliveryId}`,
        });
      }
    }
    this.validateCompleteStopSet(delivery.stops, dto.recommendedSequence);

    let routeResult: any;
    try {
      routeResult = await this.prisma.$transaction(async (tx: any) => {
        await this.lockRouteMutation(tx, deliveryId);

        if (dto.idempotencyKey) {
          await tx.idempotencyRecord.create({
            data: {
              key: dto.idempotencyKey,
              userId: actor.userId,
              endpoint,
              responseStatus: 0,
              responseBody: { pending: true },
              expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
            },
          });
        }

        const maxRoute = await tx.route.findFirst({
          where: { deliveryId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const newVersion = (maxRoute?.version || 0) + 1;

        const newRoute = await tx.route.create({
          data: {
            deliveryId,
            version: newVersion,
            source: dto.source,
            totalDistanceM: dto.totalDistanceMeters,
            estimatedDurationS: dto.estimatedDurationSeconds,
            selectedAt: new Date(),
          },
        });

        await tx.routeStop.createMany({
          data: dto.recommendedSequence.map((stopId, idx) => ({
            routeId: newRoute.id,
            deliveryStopId: stopId,
            sequence: idx + 1,
          })),
        });

        await tx.delivery.update({
          where: { id: deliveryId },
          data: { routeMode: dto.source === 'MANUAL' ? 'MANUAL' : 'RECOMMENDED_2OPT' },
        });

        const result = {
          routeId: newRoute.id,
          deliveryId: newRoute.deliveryId,
          version: newRoute.version,
          source: newRoute.source,
          selectedAt: newRoute.selectedAt,
        };

        if (dto.idempotencyKey) {
          await tx.idempotencyRecord.update({
            where: {
              key_userId_endpoint: {
                key: dto.idempotencyKey,
                userId: actor.userId,
                endpoint,
              },
            },
            data: {
              responseStatus: 201,
              responseBody: result as Prisma.InputJsonValue,
            },
          });
        }

        return result;
      });
    } catch (err: unknown) {
      if (dto.idempotencyKey && this.isUniqueConstraintError(err)) {
        const existing = await this.prisma.idempotencyRecord.findUnique({
          where: {
            key_userId_endpoint: {
              key: dto.idempotencyKey,
              userId: actor.userId,
              endpoint,
            },
          },
        });
        if (existing) {
          return {
            ...(existing.responseBody as any),
            idempotent: true,
          };
        }
      }
      throw err;
    }

    // Realtime Broadcast to room 'delivery:<deliveryId>'
    this.broadcastRouteUpdated(deliveryId, routeResult, actor);

    return routeResult;
  }

  /**
   * PATCH /v1/deliveries/:id/routes/reorder
   */
  async reorderStops(
    deliveryId: string,
    dto: ManualReorderDto,
    actor: RouteActor,
    endpoint: string = '/v1/deliveries/:id/routes/reorder',
  ) {
    const delivery = await this.verifyDeliveryAccess(deliveryId, actor);
    this.ensureDeliveryOperational(delivery.status);
    await this.enforceRouteRateLimit(deliveryId);

    // Race-Safe Idempotency Check
    if (dto.idempotencyKey) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: {
          key_userId_endpoint: {
            key: dto.idempotencyKey,
            userId: actor.userId,
            endpoint,
          },
        },
      });

      if (existing) {
        return {
          ...(existing.responseBody as any),
          idempotent: true,
        };
      }
    }

    const deliveryStopIds = new Set(delivery.stops.map((s: any) => s.id));
    for (const item of dto.stopSequence) {
      if (!deliveryStopIds.has(item.deliveryStopId)) {
        throw new UnprocessableEntityException({
          code: 'INVALID_STOP_ID',
          message: `Stop ID ${item.deliveryStopId} does not belong to delivery ${deliveryId}`,
        });
      }
    }
    this.validateCompleteStopSet(
      delivery.stops,
      dto.stopSequence.map((item) => item.deliveryStopId),
      dto.stopSequence.map((item) => item.sequence),
    );

    let reorderResult: any;
    try {
      reorderResult = await this.prisma.$transaction(async (tx: any) => {
        await this.lockRouteMutation(tx, deliveryId);

        if (dto.idempotencyKey) {
          await tx.idempotencyRecord.create({
            data: {
              key: dto.idempotencyKey,
              userId: actor.userId,
              endpoint,
              responseStatus: 0,
              responseBody: { pending: true },
              expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
            },
          });
        }

        for (const item of dto.stopSequence) {
          await tx.deliveryStop.update({
            where: { id: item.deliveryStopId },
            data: { sequence: -item.sequence },
          });
        }
        for (const item of dto.stopSequence) {
          await tx.deliveryStop.update({
            where: { id: item.deliveryStopId },
            data: { sequence: item.sequence },
          });
        }

        const maxRoute = await tx.route.findFirst({
          where: { deliveryId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const newVersion = (maxRoute?.version || 0) + 1;

        const newRoute = await tx.route.create({
          data: {
            deliveryId,
            version: newVersion,
            source: 'MANUAL',
            totalDistanceM: 0,
            estimatedDurationS: 0,
            selectedAt: new Date(),
          },
        });

        await tx.routeStop.createMany({
          data: dto.stopSequence.map((item) => ({
            routeId: newRoute.id,
            deliveryStopId: item.deliveryStopId,
            sequence: item.sequence,
          })),
        });

        await tx.delivery.update({
          where: { id: deliveryId },
          data: { routeMode: 'MANUAL' },
        });

        const result = {
          routeId: newRoute.id,
          deliveryId,
          version: newRoute.version,
          source: newRoute.source,
          updatedAt: newRoute.selectedAt,
        };

        if (dto.idempotencyKey) {
          await tx.idempotencyRecord.update({
            where: {
              key_userId_endpoint: {
                key: dto.idempotencyKey,
                userId: actor.userId,
                endpoint,
              },
            },
            data: {
              responseStatus: 200,
              responseBody: result as Prisma.InputJsonValue,
            },
          });
        }

        return result;
      });
    } catch (err: unknown) {
      if (dto.idempotencyKey && this.isUniqueConstraintError(err)) {
        const existing = await this.prisma.idempotencyRecord.findUnique({
          where: {
            key_userId_endpoint: {
              key: dto.idempotencyKey,
              userId: actor.userId,
              endpoint,
            },
          },
        });
        if (existing) {
          return {
            ...(existing.responseBody as any),
            idempotent: true,
          };
        }
      }
      throw err;
    }

    this.broadcastRouteUpdated(deliveryId, reorderResult, actor);

    return reorderResult;
  }

  /**
   * GET /v1/deliveries/:id/routes/current
   */
  async getCurrentRoute(deliveryId: string, actor: RouteActor) {
    const delivery = await this.verifyDeliveryAccess(deliveryId, actor);

    const latestRoute = await this.prisma.route.findFirst({
      where: { deliveryId },
      orderBy: { version: 'desc' },
      include: {
        routeStops: {
          orderBy: { sequence: 'asc' },
          include: { deliveryStop: true },
        },
      },
    });

    if (!latestRoute) {
      // Fallback: return delivery stops in current sequence
      return {
        routeId: null,
        deliveryId: delivery.id,
        version: 0,
        source: delivery.routeMode,
        totalDistanceMeters: 0,
        estimatedDurationSeconds: 0,
        stops: delivery.stops.map((s: any) => ({
          sequence: s.sequence,
          deliveryStopId: s.id,
          destinationName: s.destinationName,
          latitude: Number(s.latitude),
          longitude: Number(s.longitude),
        })),
      };
    }

    return {
      routeId: latestRoute.id,
      deliveryId: latestRoute.deliveryId,
      version: latestRoute.version,
      source: latestRoute.source,
      totalDistanceMeters: Number(latestRoute.totalDistanceM),
      estimatedDurationSeconds: latestRoute.estimatedDurationS,
      polylineGeojson: latestRoute.polylineGeojson || null,
      stops: latestRoute.routeStops.map((rs: any) => ({
        sequence: rs.sequence,
        deliveryStopId: rs.deliveryStopId,
        destinationName: rs.deliveryStop.destinationName,
        latitude: Number(rs.deliveryStop.latitude),
        longitude: Number(rs.deliveryStop.longitude),
      })),
    };
  }

  /**
   * GET /v1/deliveries/:id/routes/versions
   */
  async getRouteVersions(deliveryId: string, actor: RouteActor) {
    await this.verifyDeliveryAccess(deliveryId, actor);

    const routes = await this.prisma.route.findMany({
      where: { deliveryId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        source: true,
        totalDistanceM: true,
        estimatedDurationS: true,
        selectedAt: true,
      },
    });

    return {
      deliveryId,
      versions: routes.map((r: any) => ({
        routeId: r.id,
        version: r.version,
        source: r.source,
        totalDistanceMeters: Number(r.totalDistanceM),
        estimatedDurationSeconds: r.estimatedDurationS,
        selectedAt: r.selectedAt,
      })),
    };
  }

  private async lockRouteMutation(tx: any, deliveryId: string): Promise<void> {
    await tx.$executeRaw`SELECT id FROM deliveries WHERE id = ${deliveryId}::uuid FOR UPDATE`;
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError ||
      (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002');
  }

  private validateCompleteStopSet(
    deliveryStops: Array<{ id: string }>,
    submittedStopIds: string[],
    submittedSequences?: number[],
  ): void {
    const expectedIds = new Set(deliveryStops.map((stop) => stop.id));
    const submittedIds = new Set(submittedStopIds);
    const hasExactIds =
      expectedIds.size > 0 &&
      submittedStopIds.length === expectedIds.size &&
      submittedIds.size === expectedIds.size &&
      submittedStopIds.every((stopId) => expectedIds.has(stopId));

    if (!hasExactIds) {
      throw new UnprocessableEntityException({
        code: 'INVALID_STOP_SET',
        message: 'Route must contain every delivery stop exactly once',
      });
    }

    if (submittedSequences) {
      const sortedSequences = [...submittedSequences].sort((a, b) => a - b);
      const contiguous = sortedSequences.every((sequence, index) => sequence === index + 1);
      if (!contiguous) {
        throw new UnprocessableEntityException({
          code: 'INVALID_STOP_SEQUENCE',
          message: 'Route stop sequences must be unique and contiguous from 1 to N',
        });
      }
    }
  }

  private broadcastRouteUpdated(deliveryId: string, routeResult: any, actor: RouteActor) {
    if (this.realtimeGateway && this.realtimeGateway.server) {
      const envelope = formatRealtimeEvent(
        'delivery.route.updated',
        {
          deliveryId,
          routeId: routeResult.routeId,
          version: routeResult.version,
          source: routeResult.source,
        },
        {
          userId: actor.userId,
          role: actor.role,
          driverId: actor.driverId,
        },
      );

      this.realtimeGateway.server
        .to(`delivery:${deliveryId}`)
        .emit('delivery.route.updated', envelope);
    }
  }
}

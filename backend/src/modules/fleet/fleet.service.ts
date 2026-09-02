import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingCacheService } from '../tracking/services/tracking-cache.service';
import { LocationHistoryQueryDto } from './dto/location-history-query.dto';

export interface FleetDriverLocationItem {
  driverId: string;
  driverName: string;
  employeeCode: string;
  operationalStatus: string;
  activeVehicleId: string | null;
  plateNumber: string | null;
  currentDeliveryId: string | null;
  location: {
    latitude: number;
    longitude: number;
    accuracyM: number;
    speedMps: number | null;
    headingDeg: number | null;
    recordedAt: string;
    receivedAt: string;
  } | null;
}

@Injectable()
export class FleetService {
  private readonly logger = new Logger(FleetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingCacheService: TrackingCacheService,
  ) {}

  /**
   * GET /v1/fleet/locations
   * Active Drivers definition: operationalStatus != 'OFFLINE' (AVAILABLE, ON_DELIVERY, EMERGENCY)
   * Redis-first query with DB fallback if cache miss occurs.
   */
  async getAllActiveDriverLocations(
    actorUserId: string,
    actorRole: string,
  ): Promise<{ drivers: FleetDriverLocationItem[]; count: number }> {
    // 1. Role Enforcement (Only OWNER, ADMIN, SUPER_ADMIN permitted)
    if (actorRole === 'DRIVER') {
      throw new ForbiddenException({
        code: 'FLEET_ACCESS_DENIED',
        message: 'Drivers are not authorized to access fleet live location monitoring',
      });
    }

    // 2. Fetch Active Drivers from PostgreSQL
    const activeDrivers = await this.prisma.driver.findMany({
      where: {
        user: { status: 'ACTIVE' },
        operationalStatus: { in: ['AVAILABLE', 'ON_DELIVERY', 'EMERGENCY'] },
      },
      include: {
        user: { select: { id: true, username: true } },
        assignments: {
          where: { status: 'ACTIVE' },
          include: { vehicle: true },
          take: 1,
        },
        deliveries: {
          where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE'] } },
          select: { id: true },
          take: 1,
        },
      },
    });

    const driverItems: FleetDriverLocationItem[] = [];

    for (const drv of activeDrivers) {
      const activeAssignment = drv.assignments[0];
      const activeDelivery = drv.deliveries[0];

      // Redis-first query
      let locData = await this.trackingCacheService.getLatestLocation(drv.id);

      // DB Fallback if Redis cache miss
      if (!locData) {
        const dbPoints = await this.prisma.$queryRaw<any[]>`
          SELECT latitude, longitude, accuracy_m, speed_mps, heading_deg, recorded_at, received_at
          FROM location_points
          WHERE driver_id = ${drv.id}::uuid AND validation_status = 'VALID'
          ORDER BY recorded_at DESC
          LIMIT 1
        `;

        if (dbPoints && dbPoints.length > 0) {
          const pt = dbPoints[0];
          locData = {
            driverId: drv.id,
            deliveryId: activeDelivery?.id || null,
            latitude: Number(pt.latitude),
            longitude: Number(pt.longitude),
            accuracyM: Number(pt.accuracy_m),
            speedMps: pt.speed_mps !== null ? Number(pt.speed_mps) : null,
            headingDeg: pt.heading_deg !== null ? Number(pt.heading_deg) : null,
            recordedAt: new Date(pt.recorded_at).toISOString(),
            receivedAt: new Date(pt.received_at).toISOString(),
          };
        }
      }

      driverItems.push({
        driverId: drv.id,
        driverName: drv.displayName,
        employeeCode: drv.employeeCode,
        operationalStatus: drv.operationalStatus,
        activeVehicleId: drv.activeVehicleId || activeAssignment?.vehicleId || null,
        plateNumber: activeAssignment?.vehicle?.plateNumber || null,
        currentDeliveryId: activeDelivery?.id || locData?.deliveryId || null,
        location: locData
          ? {
              latitude: locData.latitude,
              longitude: locData.longitude,
              accuracyM: locData.accuracyM,
              speedMps: locData.speedMps !== undefined ? locData.speedMps : null,
              headingDeg: locData.headingDeg !== undefined ? locData.headingDeg : null,
              recordedAt: locData.recordedAt,
              receivedAt: locData.receivedAt,
            }
          : null,
      });
    }

    return {
      drivers: driverItems,
      count: driverItems.length,
    };
  }

  /**
   * GET /v1/drivers/:id/location-history
   * Unified Reconciled Policy:
   * DRIVER: ONLY IF targetDriverId === req.user.driverId (own history)
   * OWNER: Company/operational scope
   * ADMIN/SUPER_ADMIN: Full access
   */
  async getDriverLocationHistory(
    targetDriverId: string,
    query: LocationHistoryQueryDto,
    actorUserId: string,
    actorRole: string,
    actorDriverId: string | null,
  ) {
    // 1. Verify Target Driver Exists
    const targetDriver = await this.prisma.driver.findUnique({
      where: { id: targetDriverId },
      include: { user: true },
    });

    if (!targetDriver) {
      throw new NotFoundException({
        code: 'DRIVER_NOT_FOUND',
        message: `Driver with ID ${targetDriverId} does not exist`,
      });
    }

    // 2. Anti-IDOR Authorization Check
    if (actorRole === 'DRIVER') {
      if (!actorDriverId || actorDriverId !== targetDriverId) {
        this.logger.warn(
          `Anti-IDOR rejection: Driver ${actorDriverId || actorUserId} attempted to access location history of driver ${targetDriverId}`,
        );
        throw new ForbiddenException({
          code: 'RESOURCE_FORBIDDEN',
          message: 'Drivers are only authorized to view their own location history',
        });
      }
    }

    // 3. Date Range Validation (from <= to)
    const fromDate = new Date(query.from);
    const toDate = query.to ? new Date(query.to) : new Date();

    if (isNaN(fromDate.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'Query parameter "from" must be a valid ISO-8601 timestamp',
      });
    }

    if (isNaN(toDate.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'Query parameter "to" must be a valid ISO-8601 timestamp',
      });
    }

    if (fromDate > toDate) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: '"from" timestamp cannot be greater than "to" timestamp',
      });
    }

    const limit = query.limit || 100;
    const offset = query.offset || 0;

    // 4. Query Partitioned location_points Table with Date Range Pruning via Prisma Raw
    const points = await this.prisma.$queryRaw<any[]>`
      SELECT id, delivery_id, latitude, longitude, accuracy_m, speed_mps, heading_deg,
             recorded_at, received_at, validation_status
      FROM location_points
      WHERE driver_id = ${targetDriverId}::uuid
        AND recorded_at >= ${fromDate}
        AND recorded_at <= ${toDate}
        AND validation_status = 'VALID'
      ORDER BY recorded_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countRes = await this.prisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS total
      FROM location_points
      WHERE driver_id = ${targetDriverId}::uuid
        AND recorded_at >= ${fromDate}
        AND recorded_at <= ${toDate}
        AND validation_status = 'VALID'
    `;

    const totalCount = countRes && countRes[0] ? Number(countRes[0].total) : 0;

    const formattedPoints = points.map((pt) => ({
      id: pt.id,
      deliveryId: pt.delivery_id || null,
      latitude: Number(pt.latitude),
      longitude: Number(pt.longitude),
      accuracyM: Number(pt.accuracy_m),
      speedMps: pt.speed_mps !== null ? Number(pt.speed_mps) : null,
      headingDeg: pt.heading_deg !== null ? Number(pt.heading_deg) : null,
      recordedAt: new Date(pt.recorded_at).toISOString(),
      receivedAt: new Date(pt.received_at).toISOString(),
      validationStatus: pt.validation_status,
    }));

    return {
      driverId: targetDriverId,
      points: formattedPoints,
      pagination: {
        limit,
        offset,
        total: totalCount,
      },
    };
  }
}

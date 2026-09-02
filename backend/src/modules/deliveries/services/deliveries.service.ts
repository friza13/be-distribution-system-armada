import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateDeliveryDto } from '../dto/create-delivery.dto';
import { AssignDeliveryDto } from '../dto/assign-delivery.dto';
import { CancelDeliveryDto } from '../dto/cancel-delivery.dto';
import { DeliveryStatus } from '@prisma/client';
import { RealtimeGateway } from '../../realtime/gateways/realtime.gateway';
import { formatRealtimeEvent } from '../../realtime/dto/realtime-envelope.dto';
import { v4 as uuidv4 } from 'uuid';

export interface DeliveryActor {
  userId: string;
  role: string;
  driverId?: string | null;
}

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async getDeliveryById(id: string, actor: DeliveryActor) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: {
        driver: true,
        vehicle: true,
        items: true,
        stops: { orderBy: { sequence: 'asc' } },
        routes: { orderBy: { version: 'desc' }, take: 1 },
      },
    });

    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: `Delivery with ID ${id} not found`,
      });
    }

    // Object-level IDOR check for Driver
    if (actor.role === 'DRIVER') {
      if (!actor.driverId || delivery.driverId !== actor.driverId) {
        throw new ForbiddenException({
          code: 'RESOURCE_FORBIDDEN',
          message: 'You are not assigned to this delivery',
        });
      }
    }

    return delivery;
  }

  async createDelivery(dto: CreateDeliveryDto, creatorUserId: string) {
    const existingCode = await this.prisma.delivery.findUnique({
      where: { deliveryCode: dto.deliveryCode },
    });

    if (existingCode) {
      throw new BadRequestException({
        code: 'DUPLICATE_DELIVERY_CODE',
        message: `Delivery code ${dto.deliveryCode} already exists`,
      });
    }

    return this.prisma.$transaction(async (tx: any) => {
      const delivery = await tx.delivery.create({
        data: {
          deliveryCode: dto.deliveryCode,
          status: 'DRAFT',
          routeMode: 'RECOMMENDED_2OPT',
          plannedStartAt: dto.plannedStartAt ? new Date(dto.plannedStartAt) : null,
          createdBy: creatorUserId,
        },
      });

      // Insert Items
      await tx.deliveryItem.createMany({
        data: dto.items.map((item: any) => ({
          deliveryId: delivery.id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          quantity: item.quantity,
          unit: item.unit,
          weightKg: item.weightKg || null,
          volumeM3: item.volumeM3 || null,
        })),
      });

      // Insert Stops (PostGIS sync trigger will execute automatically)
      for (const stop of dto.stops) {
        const stopId = uuidv4();
        await tx.$executeRaw`
          INSERT INTO delivery_stops (
            id, delivery_id, sequence, destination_name, address,
            latitude, longitude, geom, geofence_radius_m, status
          ) VALUES (
            ${stopId}::uuid,
            ${delivery.id}::uuid,
            ${stop.sequence},
            ${stop.destinationName},
            ${stop.address},
            ${stop.latitude},
            ${stop.longitude},
            ST_SetSRID(ST_MakePoint(${stop.longitude}, ${stop.latitude}), 4326),
            ${stop.geofenceRadiusM || 100},
            'PENDING'
          )
        `;
      }

      await tx.auditLog.create({
        data: {
          actorUserId: creatorUserId,
          action: 'DELIVERY_CREATED',
          entityType: 'DELIVERY',
          entityId: delivery.id,
          result: 'SUCCESS',
        },
      });

      return delivery;
    });
  }

  async assignDelivery(deliveryId: string, dto: AssignDeliveryDto, actor: DeliveryActor) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
    }

    if (delivery.status !== 'DRAFT' && delivery.status !== 'ASSIGNED') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot assign delivery in state ${delivery.status}. Expected DRAFT or ASSIGNED`,
      });
    }

    const driver = await this.prisma.driver.findUnique({ where: { id: dto.driverId } });
    if (!driver) {
      throw new NotFoundException({ code: 'DRIVER_NOT_FOUND', message: 'Driver not found' });
    }

    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: dto.vehicleId } });
    if (!vehicle) {
      throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' });
    }

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        driverId: dto.driverId,
        vehicleId: dto.vehicleId,
        status: 'ASSIGNED',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'DELIVERY_ASSIGNED',
        entityType: 'DELIVERY',
        entityId: deliveryId,
        result: 'SUCCESS',
        afterJson: { driverId: dto.driverId, vehicleId: dto.vehicleId },
      },
    });

    this.broadcastStatusChanged(deliveryId, 'ASSIGNED', actor);

    return updated;
  }

  async acceptDelivery(deliveryId: string, actorDriverId: string, actorUserId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });

    if (!delivery) {
      throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
    }

    if (delivery.driverId !== actorDriverId) {
      throw new ForbiddenException({
        code: 'RESOURCE_FORBIDDEN',
        message: 'You are not the assigned driver for this delivery',
      });
    }

    if (delivery.status !== 'ASSIGNED') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot accept delivery in state ${delivery.status}. Expected ASSIGNED`,
      });
    }

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: 'ACCEPTED' },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'DELIVERY_ACCEPTED',
        entityType: 'DELIVERY',
        entityId: deliveryId,
        result: 'SUCCESS',
      },
    });

    this.broadcastStatusChanged(deliveryId, 'ACCEPTED', { userId: actorUserId, role: 'DRIVER', driverId: actorDriverId });

    return updated;
  }

  async startDelivery(deliveryId: string, actorDriverId: string, actorUserId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });

    if (!delivery) {
      throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
    }

    if (delivery.driverId !== actorDriverId) {
      throw new ForbiddenException({
        code: 'RESOURCE_FORBIDDEN',
        message: 'You are not the assigned driver for this delivery',
      });
    }

    if (delivery.status !== 'ACCEPTED') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot start delivery in state ${delivery.status}. Expected ACCEPTED`,
      });
    }

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: 'EN_ROUTE',
        startedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'DELIVERY_STARTED',
        entityType: 'DELIVERY',
        entityId: deliveryId,
        result: 'SUCCESS',
      },
    });

    this.broadcastStatusChanged(deliveryId, 'EN_ROUTE', { userId: actorUserId, role: 'DRIVER', driverId: actorDriverId });

    return updated;
  }

  async completeDelivery(deliveryId: string, actor: DeliveryActor) {
    const delivery = await this.getDeliveryById(deliveryId, actor);

    if (delivery.status === 'COMPLETED') {
      return {
        status: 'COMPLETED',
        alreadyCompleted: true,
        deliveryId,
      };
    }

    if (delivery.status !== 'EN_ROUTE') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot complete delivery in status ${delivery.status}. Expected EN_ROUTE`,
      });
    }

    const isEligible = await this.evaluateDeliveryCompletion(deliveryId);

    if (!isEligible.completed) {
      throw new ConflictException({
        code: 'UNFINISHED_STOPS_REMAIN',
        message: 'Cannot complete delivery: unfinished or active stops remain',
        unfinishedStops: isEligible.unfinishedStops,
      });
    }

    const finalStatus = isEligible.targetStatus || 'COMPLETED';

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: finalStatus === 'COMPLETED' ? 'DELIVERY_COMPLETED' : 'DELIVERY_FAILED',
        entityType: 'DELIVERY',
        entityId: deliveryId,
        result: 'SUCCESS',
      },
    });

    this.broadcastStatusChanged(deliveryId, finalStatus, actor);

    return updated;
  }

  async cancelDelivery(deliveryId: string, dto: CancelDeliveryDto, actor: DeliveryActor) {
    const delivery = await this.getDeliveryById(deliveryId, actor);

    if (delivery.status === 'COMPLETED' || delivery.status === 'CANCELLED' || delivery.status === 'FAILED') {
      throw new ConflictException({
        code: 'TERMINAL_STATE_CANNOT_BE_CANCELLED',
        message: `Delivery in terminal state ${delivery.status} cannot be cancelled`,
      });
    }

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: 'CANCELLED' },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'DELIVERY_CANCELLED',
        entityType: 'DELIVERY',
        entityId: deliveryId,
        result: 'SUCCESS',
        afterJson: { reason: dto.reason },
      },
    });

    this.broadcastStatusChanged(deliveryId, 'CANCELLED', actor);

    return updated;
  }

  /**
   * Single Source of Truth completion evaluator.
   * Checks if ALL stops are terminal (DELIVERED, FAILED, SKIPPED).
   * - If at least 1 stop is DELIVERED -> targetStatus: COMPLETED.
   * - If 0 stops are DELIVERED (all FAILED/SKIPPED) -> targetStatus: FAILED.
   */
  async evaluateDeliveryCompletion(deliveryId: string, tx?: any): Promise<{ completed: boolean; targetStatus?: 'COMPLETED' | 'FAILED'; unfinishedStops?: any[] }> {
    const client = tx || this.prisma;
    const stops = await client.deliveryStop.findMany({
      where: { deliveryId },
    });

    if (!stops || stops.length === 0) {
      return { completed: false };
    }

    const terminalStatuses = new Set(['DELIVERED', 'FAILED', 'SKIPPED']);
    const unfinishedStops = stops.filter((s: any) => !terminalStatuses.has(s.status));

    if (unfinishedStops.length > 0) {
      return { completed: false, unfinishedStops };
    }

    const hasDeliveredStop = stops.some((s: any) => s.status === 'DELIVERED');
    const targetStatus = hasDeliveredStop ? 'COMPLETED' : 'FAILED';

    return { completed: true, targetStatus };
  }

  /**
   * Helper method to automatically mark delivery as COMPLETED or FAILED if eligible.
   */
  async completeDeliveryIfEligible(deliveryId: string, actor: DeliveryActor) {
    try {
      const evaluation = await this.evaluateDeliveryCompletion(deliveryId);
      if (evaluation.completed && evaluation.targetStatus) {
        const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
        if (delivery && delivery.status === 'EN_ROUTE') {
          await this.prisma.delivery.update({
            where: { id: deliveryId },
            data: { status: evaluation.targetStatus, completedAt: new Date() },
          });
          this.broadcastStatusChanged(deliveryId, evaluation.targetStatus, actor);
        }
      }
    } catch (err: unknown) {
      this.logger.warn(`Failed to auto-complete delivery ${deliveryId}: ${err}`);
    }
  }
  private broadcastStatusChanged(deliveryId: string, newStatus: DeliveryStatus, actor: DeliveryActor) {
    if (this.realtimeGateway && this.realtimeGateway.server) {
      const envelope = formatRealtimeEvent(
        'delivery.status_changed',
        { deliveryId, status: newStatus },
        {
          userId: actor.userId,
          role: actor.role,
          driverId: actor.driverId || null,
        },
      );
      this.realtimeGateway.server.to(`delivery:${deliveryId}`).emit('delivery.status_changed', envelope);
      this.realtimeGateway.server.to('fleet:monitoring').emit('delivery.status_changed', envelope);
    }
  }
}

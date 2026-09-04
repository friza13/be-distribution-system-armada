import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  UnprocessableEntityException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DeliveriesService, DeliveryActor } from './deliveries.service';
import { FailStopDto, SkipStopDto } from '../dto/stop-status.dto';
import { DeliveryStatus, StopStatus } from '@prisma/client';
import { RealtimeGateway } from '../../realtime/gateways/realtime.gateway';
import { formatRealtimeEvent } from '../../realtime/dto/realtime-envelope.dto';

const TERMINAL_DELIVERY_STATUSES: DeliveryStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];

@Injectable()
export class DeliveryStopsService {
  private readonly logger = new Logger(DeliveryStopsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveriesService: DeliveriesService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async getStopAndVerifyDriver(stopId: string, actorDriverId?: string | null) {
    const stop = await this.prisma.deliveryStop.findUnique({
      where: { id: stopId },
      include: { delivery: true },
    });

    if (!stop) {
      throw new NotFoundException({
        code: 'STOP_NOT_FOUND',
        message: `Delivery stop ${stopId} not found`,
      });
    }

    if (actorDriverId) {
      if (stop.delivery.driverId !== actorDriverId) {
        throw new ForbiddenException({
          code: 'RESOURCE_FORBIDDEN',
          message: 'You are not assigned to the delivery for this stop',
        });
      }
    }

    return stop;
  }

  async departToStop(stopId: string, actorDriverId: string, actorUserId: string) {
    const stop = await this.getStopAndVerifyDriver(stopId, actorDriverId);

    if (stop.delivery.status !== 'EN_ROUTE') {
      throw new ConflictException({
        code: 'INVALID_DELIVERY_STATE',
        message: `Cannot depart to stop while delivery is in state ${stop.delivery.status}. Expected EN_ROUTE`,
      });
    }

    if (stop.status !== 'PENDING') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot depart to stop in status ${stop.status}. Expected PENDING`,
      });
    }

    const updated = await this.updateStopIfOperational(stopId, 'PENDING', { status: 'EN_ROUTE' });

    this.broadcastStopStatusChanged(stop.deliveryId, stopId, 'EN_ROUTE', {
      userId: actorUserId,
      role: 'DRIVER',
      driverId: actorDriverId,
    });

    return updated;
  }

  async arriveAtStop(stopId: string, actorDriverId: string, actorUserId: string) {
    const stop = await this.getStopAndVerifyDriver(stopId, actorDriverId);

    if (stop.delivery.status !== 'EN_ROUTE') {
      throw new ConflictException({
        code: 'INVALID_DELIVERY_STATE',
        message: `Cannot arrive at stop while delivery is in state ${stop.delivery.status}. Expected EN_ROUTE`,
      });
    }

    if (stop.status !== 'EN_ROUTE' && stop.status !== 'PENDING') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot arrive at stop in status ${stop.status}. Expected EN_ROUTE or PENDING`,
      });
    }

    const updated = await this.updateStopIfOperational(stopId, { in: ['EN_ROUTE', 'PENDING'] }, {
      status: 'ARRIVED',
      arrivedAt: new Date(),
    });

    this.broadcastStopStatusChanged(stop.deliveryId, stopId, 'ARRIVED', {
      userId: actorUserId,
      role: 'DRIVER',
      driverId: actorDriverId,
    });

    return updated;
  }

  async startUnloading(stopId: string, actorDriverId: string, actorUserId: string) {
    const stop = await this.getStopAndVerifyDriver(stopId, actorDriverId);

    this.ensureDeliveryOperational(stop.delivery.status);

    if (stop.status !== 'ARRIVED') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot start unloading at stop in status ${stop.status}. Expected ARRIVED`,
      });
    }

    const updated = await this.updateStopIfOperational(stopId, 'ARRIVED', { status: 'UNLOADING' });

    this.broadcastStopStatusChanged(stop.deliveryId, stopId, 'UNLOADING', {
      userId: actorUserId,
      role: 'DRIVER',
      driverId: actorDriverId,
    });

    return updated;
  }

  async failStop(stopId: string, dto: FailStopDto, actorDriverId: string, actorUserId: string) {
    const stop = await this.getStopAndVerifyDriver(stopId, actorDriverId);

    this.ensureDeliveryOperational(stop.delivery.status);

    if (stop.status !== 'ARRIVED' && stop.status !== 'UNLOADING' && stop.status !== 'EN_ROUTE') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot fail stop in status ${stop.status}`,
      });
    }

    const updated = await this.updateStopIfOperational(stopId, { in: ['ARRIVED', 'UNLOADING', 'EN_ROUTE'] }, {
      status: 'FAILED',
      completedAt: new Date(),
    });

    await this.prisma.deliveryEvent.create({
      data: {
        deliveryId: stop.deliveryId,
        stopId: stop.id,
        eventType: 'STOP_FAILED',
        actorUserId,
        metadataJson: { reason: dto.reason || 'Stop execution failed' },
      },
    });

    this.broadcastStopStatusChanged(stop.deliveryId, stopId, 'FAILED', {
      userId: actorUserId,
      role: 'DRIVER',
      driverId: actorDriverId,
    });

    // Evaluate delivery completion automatically
    await this.deliveriesService.completeDeliveryIfEligible(stop.deliveryId, {
      userId: actorUserId,
      role: 'DRIVER',
      driverId: actorDriverId,
    });

    return updated;
  }

  async skipStop(stopId: string, dto: SkipStopDto, actor: DeliveryActor) {
    const stop = await this.getStopAndVerifyDriver(
      stopId,
      actor.role === 'DRIVER' ? actor.driverId : undefined,
    );

    this.ensureDeliveryOperational(stop.delivery.status);

    if (stop.status !== 'PENDING') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot skip stop in status ${stop.status}. Expected PENDING`,
      });
    }

    const updated = await this.updateStopIfOperational(stopId, 'PENDING', { status: 'SKIPPED' });

    await this.prisma.deliveryEvent.create({
      data: {
        deliveryId: stop.deliveryId,
        stopId: stop.id,
        eventType: 'STOP_SKIPPED',
        actorUserId: actor.userId,
        metadataJson: { reason: dto.reason || 'Stop skipped by operator' },
      },
    });

    this.broadcastStopStatusChanged(stop.deliveryId, stopId, 'SKIPPED', actor);

    // Evaluate delivery completion automatically
    await this.deliveriesService.completeDeliveryIfEligible(stop.deliveryId, actor);

    return updated;
  }

  private ensureDeliveryOperational(status: DeliveryStatus): void {
    if (TERMINAL_DELIVERY_STATUSES.includes(status)) {
      throw new ConflictException({
        code: 'INVALID_DELIVERY_STATE',
        message: `Cannot mutate stop while delivery is in state ${status}`,
      });
    }
  }

  private async updateStopIfOperational(stopId: string, expectedStatus: any, data: any) {
    const result = await this.prisma.deliveryStop.updateMany({
      where: {
        id: stopId,
        status: expectedStatus,
        delivery: { status: { notIn: TERMINAL_DELIVERY_STATUSES } },
      },
      data,
    });

    if (result.count !== 1) {
      const current = await this.prisma.deliveryStop.findUnique({
        where: { id: stopId },
        include: { delivery: true },
      });
      if (current?.delivery && TERMINAL_DELIVERY_STATUSES.includes(current.delivery.status)) {
        throw new ConflictException({
          code: 'INVALID_DELIVERY_STATE',
          message: `Cannot mutate stop while delivery is in state ${current.delivery.status}`,
        });
      }
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot mutate stop ${stopId} from its current state`,
      });
    }

    return this.prisma.deliveryStop.findUnique({ where: { id: stopId }, include: { delivery: true } });
  }

  private broadcastStopStatusChanged(
    deliveryId: string,
    stopId: string,
    newStatus: StopStatus,
    actor: DeliveryActor,
  ) {
    if (this.realtimeGateway && this.realtimeGateway.server) {
      const envelope = formatRealtimeEvent(
        'delivery.stop.status_changed',
        { deliveryId, stopId, status: newStatus },
        {
          userId: actor.userId,
          role: actor.role,
          driverId: actor.driverId || null,
        },
      );
      this.realtimeGateway.server.to(`delivery:${deliveryId}`).emit('delivery.stop.status_changed', envelope);
    }
  }
}

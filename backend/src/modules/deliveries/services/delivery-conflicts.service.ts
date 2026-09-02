import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DeliveriesService } from './deliveries.service';
import { DeliveryStopsService } from './delivery-stops.service';
import { PodService } from '../../pod/services/pod.service';
import { OutboxSyncDto } from '../dto/outbox-sync.dto';
import { ResolveConflictDto } from '../dto/resolve-conflict.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class DeliveryConflictsService {
  private readonly logger = new Logger(DeliveryConflictsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveriesService: DeliveriesService,
    private readonly deliveryStopsService: DeliveryStopsService,
    private readonly podService: PodService,
  ) {}

  async syncOutbox(dto: OutboxSyncDto, actorDriverId: string, actorUserId: string) {
    const acked: string[] = [];
    const conflicts: Array<{ clientEventId: string; conflictId: string; type: string }> = [];

    for (const item of dto.events) {
      try {
        const payload = item.payload || {};
        const stopId = payload.deliveryStopId || payload.stopId;

        if (stopId) {
          const stop = await this.prisma.deliveryStop.findUnique({
            where: { id: stopId },
            include: { delivery: true },
          });

          if (stop) {
            // Check if Delivery is already CANCELLED on server while Driver sends stop completion offline
            if (stop.delivery.status === 'CANCELLED') {
              this.logger.warn(
                `Conflict detected for offline event ${item.clientEventId}: Delivery ${stop.deliveryId} is CANCELLED on server`,
              );

              // EVIDENCE PRESERVATION: Preserve POD photo/signature and create DeliveryConflict ticket
              const conflict = await this.prisma.deliveryConflict.create({
                data: {
                  deliveryId: stop.deliveryId,
                  clientEventId: item.clientEventId,
                  conflictType: 'STALE_OFFLINE_COMPLETION',
                  serverState: 'CANCELLED',
                  clientPayload: item as unknown as Prisma.InputJsonValue,
                  status: 'OPEN',
                },
              });

              conflicts.push({
                clientEventId: item.clientEventId,
                conflictId: conflict.id,
                type: 'STALE_OFFLINE_COMPLETION',
              });

              continue;
            }
          }
        }

        // Process standard event by type
        if (item.eventType === 'stop.depart' && stopId) {
          await this.deliveryStopsService.departToStop(stopId, actorDriverId, actorUserId);
        } else if (item.eventType === 'stop.arrive' && stopId) {
          await this.deliveryStopsService.arriveAtStop(stopId, actorDriverId, actorUserId);
        } else if (item.eventType === 'stop.unload' && stopId) {
          await this.deliveryStopsService.startUnloading(stopId, actorDriverId, actorUserId);
        } else if (item.eventType === 'stop.pod' && stopId) {
          await this.podService.submitPod(
            stopId,
            {
              receiverName: payload.receiverName || 'Offline Receiver',
              photoFileId: payload.photoFileId,
              signatureFileId: payload.signatureFileId,
              notes: payload.notes,
              idempotencyKey: item.idempotencyKey,
            },
            { userId: actorUserId, role: 'DRIVER', driverId: actorDriverId },
          );
        }

        acked.push(item.clientEventId);
      } catch (err: unknown) {
        this.logger.warn(`Failed to sync offline event ${item.clientEventId}: ${err}`);
      }
    }

    return {
      acked,
      conflicts,
    };
  }

  async getOpenConflicts(actorUserId: string, actorRole: string) {
    if (actorRole === 'DRIVER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Drivers are not authorized to view system conflict tickets',
      });
    }

    const conflicts = await this.prisma.deliveryConflict.findMany({
      where: { status: 'OPEN' },
      include: {
        delivery: {
          include: {
            driver: true,
            stops: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      conflicts: conflicts.map((c) => ({
        conflictId: c.id,
        deliveryId: c.deliveryId,
        deliveryCode: c.delivery.deliveryCode,
        clientEventId: c.clientEventId,
        conflictType: c.conflictType,
        serverState: c.serverState,
        clientPayload: c.clientPayload,
        status: c.status,
        createdAt: c.createdAt,
      })),
    };
  }

  async resolveConflict(conflictId: string, dto: ResolveConflictDto, actorUserId: string, actorRole: string) {
    if (actorRole === 'DRIVER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Drivers are not authorized to resolve conflict tickets',
      });
    }

    const conflict = await this.prisma.deliveryConflict.findUnique({
      where: { id: conflictId },
      include: { delivery: true },
    });

    if (!conflict) {
      throw new NotFoundException({
        code: 'CONFLICT_NOT_FOUND',
        message: `Conflict ticket ${conflictId} not found`,
      });
    }

    if (conflict.status !== 'OPEN') {
      throw new BadRequestException({
        code: 'CONFLICT_ALREADY_RESOLVED',
        message: `Conflict ticket ${conflictId} is already ${conflict.status}`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Update conflict status
      const updatedConflict = await tx.deliveryConflict.update({
        where: { id: conflictId },
        data: {
          status: dto.status,
          resolvedBy: actorUserId,
          resolutionNotes: dto.resolutionNotes || null,
          resolvedAt: new Date(),
        },
      });

      // 2. If RESOLVED_OVERRIDDEN: Accept the POD evidence and complete the stop
      if (dto.status === 'RESOLVED_OVERRIDDEN') {
        const payload = conflict.clientPayload as any;
        const eventPayload = payload?.payload || {};
        const stopId = eventPayload?.deliveryStopId || eventPayload?.stopId;

        if (stopId) {
          // Create POD record if photo exists
          if (eventPayload.receiverName) {
            await tx.proofOfDelivery.upsert({
              where: { deliveryStopId: stopId },
              update: {
                receiverName: eventPayload.receiverName,
                photoFileId: eventPayload.photoFileId || null,
                notes: `Resolved via Conflict Override by ${actorUserId}`,
              },
              create: {
                deliveryStopId: stopId,
                receiverName: eventPayload.receiverName,
                photoFileId: eventPayload.photoFileId || null,
                notes: `Resolved via Conflict Override by ${actorUserId}`,
                createdBy: actorUserId,
              },
            });
          }

          // Mark stop as DELIVERED
          await tx.deliveryStop.update({
            where: { id: stopId },
            data: { status: 'DELIVERED', completedAt: new Date() },
          });

          // Evaluate delivery completion
          const allStops = await tx.deliveryStop.findMany({ where: { deliveryId: conflict.deliveryId } });
          const terminal = new Set(['DELIVERED', 'FAILED', 'SKIPPED']);
          const allTerminal = allStops.every((s: any) => terminal.has(s.status));
          const hasDelivered = allStops.some((s: any) => s.status === 'DELIVERED');

          if (allTerminal && hasDelivered) {
            await tx.delivery.update({
              where: { id: conflict.deliveryId },
              data: { status: 'COMPLETED', completedAt: new Date() },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CONFLICT_RESOLVED',
          entityType: 'DELIVERY_CONFLICT',
          entityId: conflictId,
          result: 'SUCCESS',
          afterJson: { status: dto.status, notes: dto.resolutionNotes },
        },
      });

      return updatedConflict;
    });
  }
}

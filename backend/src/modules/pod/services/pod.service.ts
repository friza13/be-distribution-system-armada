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
import { RedisService } from '../../../common/redis/redis.service';
import { DeliveryStopsService } from '../../deliveries/services/delivery-stops.service';
import { DeliveriesService, DeliveryActor } from '../../deliveries/services/deliveries.service';
import { SubmitPodDto } from '../dto/submit-pod.dto';
import { RealtimeGateway } from '../../realtime/gateways/realtime.gateway';
import { formatRealtimeEvent } from '../../realtime/dto/realtime-envelope.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PodService {
  private readonly logger = new Logger(PodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly deliveryStopsService: DeliveryStopsService,
    private readonly deliveriesService: DeliveriesService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async submitPod(
    stopId: string,
    dto: SubmitPodDto,
    actor: DeliveryActor,
    endpoint: string = '/v1/me/stops/:id/pod',
  ) {
    const stop = await this.deliveryStopsService.getStopAndVerifyDriver(
      stopId,
      actor.role === 'DRIVER' ? actor.driverId : undefined,
    );

    if (dto.idempotencyKey) {
      const existingRecord = await this.prisma.idempotencyRecord.findUnique({
        where: {
          key_userId_endpoint: {
            key: dto.idempotencyKey,
            userId: actor.userId,
            endpoint,
          },
        },
      });

      if (existingRecord) {
        return {
          ...(existingRecord.responseBody as any),
          idempotent: true,
        };
      }
    }

    if (stop.status === 'DELIVERED') {
      const existingPod = await this.prisma.proofOfDelivery.findUnique({
        where: { deliveryStopId: stopId },
      });
      return {
        podId: existingPod?.id,
        deliveryStopId: stopId,
        status: 'DELIVERED',
        completedAt: existingPod?.completedAt || stop.completedAt,
        alreadySubmitted: true,
      };
    }

    if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(stop.delivery.status)) {
      throw new ConflictException({
        code: 'INVALID_DELIVERY_STATE',
        message: `Cannot submit POD while delivery is in state ${stop.delivery.status}`,
      });
    }

    if (stop.status !== 'UNLOADING' && stop.status !== 'ARRIVED') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot submit POD for stop in status ${stop.status}. Expected UNLOADING or ARRIVED`,
      });
    }

    // Claim idempotency and process POD creation in one database transaction.
    let podResult: any;
    try {
      podResult = await this.prisma.$transaction(async (tx: any) => {
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

        // Claim the stop only while its parent delivery is operational.
        const claimed = await tx.deliveryStop.updateMany({
          where: {
            id: stopId,
            status: { in: ['UNLOADING', 'ARRIVED'] },
            delivery: { status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] } },
          },
          data: { status: 'DELIVERED', completedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new ConflictException({
            code: 'INVALID_DELIVERY_STATE',
            message: 'Cannot submit POD after the delivery has become terminal',
          });
        }

        // Create ProofOfDelivery record after claiming the stop.
        const pod = await tx.proofOfDelivery.create({
          data: {
            deliveryStopId: stopId,
            receiverName: dto.receiverName,
            photoFileId: dto.photoFileId || null,
            signatureFileId: dto.signatureFileId || null,
            notes: dto.notes || null,
            completedAt: new Date(),
            createdBy: actor.userId,
          },
        });

        // Log DeliveryEvent
        await tx.deliveryEvent.create({
          data: {
            deliveryId: stop.deliveryId,
            stopId,
            eventType: 'POD_SUBMITTED',
            actorUserId: actor.userId,
            metadataJson: { podId: pod.id, receiverName: dto.receiverName },
          },
        });

        const result = {
          podId: pod.id,
          deliveryStopId: stopId,
          status: 'DELIVERED',
          completedAt: pod.completedAt,
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
        const existingRecord = await this.prisma.idempotencyRecord.findUnique({
          where: {
            key_userId_endpoint: {
              key: dto.idempotencyKey,
              userId: actor.userId,
              endpoint,
            },
          },
        });

        if (existingRecord) {
          return {
            ...(existingRecord.responseBody as any),
            idempotent: true,
          };
        }
      }
      throw err;
    }

    // Broadcast realtime event 'delivery.pod.created' and 'delivery.stop.status_changed'
    this.broadcastPodCreated(stop.deliveryId, stopId, podResult, actor);

    // Auto-evaluate delivery completion if all stops finished
    await this.deliveriesService.completeDeliveryIfEligible(stop.deliveryId, actor);

    return podResult;
  }

  async getPodForDelivery(deliveryId: string, actor: DeliveryActor) {
    await this.deliveriesService.getDeliveryById(deliveryId, actor);

    const pods = await this.prisma.proofOfDelivery.findMany({
      where: { deliveryStop: { deliveryId } },
      include: {
        deliveryStop: true,
        photoFile: true,
        signatureFile: true,
      },
    });

    return {
      deliveryId,
      pods: pods.map((p) => ({
        podId: p.id,
        deliveryStopId: p.deliveryStopId,
        stopSequence: p.deliveryStop.sequence,
        destinationName: p.deliveryStop.destinationName,
        receiverName: p.receiverName,
        photoFileId: p.photoFileId || null,
        signatureFileId: p.signatureFileId || null,
        notes: p.notes || null,
        completedAt: p.completedAt,
      })),
    };
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') ||
      (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002');
  }

  private broadcastPodCreated(deliveryId: string, stopId: string, podResult: any, actor: DeliveryActor) {
    if (this.realtimeGateway && this.realtimeGateway.server) {
      const envelope = formatRealtimeEvent(
        'delivery.pod.created',
        { deliveryId, stopId, podId: podResult.podId, status: 'DELIVERED' },
        {
          userId: actor.userId,
          role: actor.role,
          driverId: actor.driverId || null,
        },
      );
      this.realtimeGateway.server.to(`delivery:${deliveryId}`).emit('delivery.pod.created', envelope);
    }
  }
}

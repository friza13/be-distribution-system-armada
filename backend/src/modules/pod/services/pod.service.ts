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

    if (stop.status !== 'UNLOADING' && stop.status !== 'ARRIVED') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot submit POD for stop in status ${stop.status}. Expected UNLOADING or ARRIVED`,
      });
    }

    // Race-Safe Idempotency Check
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

    // Process POD creation and stop status transition inside database transaction
    const podResult = await this.prisma.$transaction(async (tx: any) => {
      // 1. Create ProofOfDelivery record
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

      // 2. Update DeliveryStop status to DELIVERED
      await tx.deliveryStop.update({
        where: { id: stopId },
        data: {
          status: 'DELIVERED',
          completedAt: new Date(),
        },
      });

      // 3. Log DeliveryEvent
      await tx.deliveryEvent.create({
        data: {
          deliveryId: stop.deliveryId,
          stopId,
          eventType: 'POD_SUBMITTED',
          actorUserId: actor.userId,
          metadataJson: { podId: pod.id, receiverName: dto.receiverName },
        },
      });

      return {
        podId: pod.id,
        deliveryStopId: stopId,
        status: 'DELIVERED',
        completedAt: pod.completedAt,
      };
    });

    // Save Idempotency Record if key provided
    if (dto.idempotencyKey) {
      try {
        await this.prisma.idempotencyRecord.create({
          data: {
            key: dto.idempotencyKey,
            userId: actor.userId,
            endpoint,
            responseStatus: 201,
            responseBody: podResult as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
          },
        });
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          this.logger.debug(`Idempotency collision caught for POD submit key ${dto.idempotencyKey}`);
        }
      }
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

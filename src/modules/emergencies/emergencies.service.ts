import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TriggerEmergencyDto } from './dto/trigger-emergency.dto';
import { UpdateEmergencyStatusDto } from './dto/update-emergency-status.dto';
import { RealtimeGateway } from '../realtime/gateways/realtime.gateway';
import { formatRealtimeEvent } from '../realtime/dto/realtime-envelope.dto';

@Injectable()
export class EmergenciesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async triggerEmergency(driverId: string, actorUserId: string, dto: TriggerEmergencyDto) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true },
    });

    if (!driver) {
      throw new NotFoundException({ code: 'DRIVER_NOT_FOUND', message: 'Driver not found' });
    }

    // Check single active SOS invariant per driver
    const activeEmergency = await this.prisma.emergency.findFirst({
      where: {
        driverId,
        status: { in: ['TRIGGERED', 'ACKNOWLEDGED'] },
      },
    });

    if (activeEmergency) {
      throw new ConflictException({
        code: 'ACTIVE_EMERGENCY_EXISTS',
        message: 'Driver already has an active unresolved emergency',
      });
    }

    return this.prisma.$transaction(async (tx: any) => {
      const emergency = await tx.emergency.create({
        data: {
          driverId,
          deliveryId: dto.deliveryId || null,
          latitude: dto.latitude,
          longitude: dto.longitude,
          emergencyType: dto.emergencyType,
          note: dto.note || null,
          status: 'TRIGGERED',
        },
      });

      await tx.driver.update({
        where: { id: driverId },
        data: { operationalStatus: 'EMERGENCY' },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'EMERGENCY_TRIGGERED',
          entityType: 'EMERGENCY',
          entityId: emergency.id,
          result: 'SUCCESS',
        },
      });

      // Broadcast alert to fleet:monitoring and organization
      if (this.realtimeGateway?.server) {
        const envelope = formatRealtimeEvent(
          'emergency.triggered',
          {
            emergencyId: emergency.id,
            driverId,
            driverName: driver.displayName,
            latitude: dto.latitude,
            longitude: dto.longitude,
            emergencyType: dto.emergencyType,
          },
          { userId: actorUserId, role: 'DRIVER', driverId },
        );
        this.realtimeGateway.server.to('fleet:monitoring').emit('emergency.triggered', envelope);
      }

      return emergency;
    });
  }

  async getActiveEmergency(driverId: string) {
    const emergency = await this.prisma.emergency.findFirst({
      where: {
        driverId,
        status: { in: ['TRIGGERED', 'ACKNOWLEDGED'] },
      },
    });

    if (!emergency) {
      throw new NotFoundException({ code: 'NO_ACTIVE_EMERGENCY', message: 'No active emergency found' });
    }

    return emergency;
  }

  async listEmergencies(actor: { userId: string; role: string; organizationId?: string | null }) {
    return {
      emergencies: await this.prisma.emergency.findMany({
        orderBy: { triggeredAt: 'desc' },
        include: {
          driver: { select: { id: true, displayName: true, phone: true, employeeCode: true } },
          delivery: { select: { id: true, deliveryCode: true } },
        },
      }),
    };
  }

  async getEmergencyById(id: string) {
    const emergency = await this.prisma.emergency.findUnique({
      where: { id },
      include: {
        driver: { select: { id: true, displayName: true, phone: true } },
        delivery: { select: { id: true, deliveryCode: true } },
      },
    });

    if (!emergency) {
      throw new NotFoundException({ code: 'EMERGENCY_NOT_FOUND', message: 'Emergency not found' });
    }

    return emergency;
  }

  async updateEmergencyStatus(
    id: string,
    dto: UpdateEmergencyStatusDto,
    actorUserId: string,
  ) {
    const emergency = await this.prisma.emergency.findUnique({
      where: { id },
      include: { driver: true },
    });

    if (!emergency) {
      throw new NotFoundException({ code: 'EMERGENCY_NOT_FOUND', message: 'Emergency not found' });
    }

    if (emergency.status === 'RESOLVED' || emergency.status === 'FALSE_ALARM') {
      throw new ConflictException({
        code: 'EMERGENCY_ALREADY_TERMINAL',
        message: 'Cannot update an already resolved or false alarm emergency',
      });
    }

    return this.prisma.$transaction(async (tx: any) => {
      const isTerminal = dto.status === 'RESOLVED' || dto.status === 'FALSE_ALARM';
      const updated = await tx.emergency.update({
        where: { id },
        data: {
          status: dto.status,
          ...(isTerminal ? { resolvedAt: new Date(), resolvedBy: actorUserId } : {}),
        },
      });

      if (isTerminal) {
        // Evaluate driver active delivery state
        const activeDelivery = await tx.delivery.findFirst({
          where: {
            driverId: emergency.driverId,
            status: { in: ['ACCEPTED', 'EN_ROUTE'] },
          },
        });

        const nextStatus = activeDelivery ? 'ON_DELIVERY' : 'AVAILABLE';
        await tx.driver.update({
          where: { id: emergency.driverId },
          data: { operationalStatus: nextStatus },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: `EMERGENCY_${dto.status}`,
          entityType: 'EMERGENCY',
          entityId: id,
          result: 'SUCCESS',
        },
      });

      return updated;
    });
  }
}

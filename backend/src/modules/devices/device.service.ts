import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    const existing = await this.prisma.device.findFirst({
      where: {
        userId,
        deviceIdentifier: dto.deviceIdentifier,
      },
    });

    if (existing) {
      const updated = await this.prisma.device.update({
        where: { id: existing.id },
        data: {
          platform: dto.platform,
          appVersion: dto.appVersion,
          pushToken: dto.pushToken || existing.pushToken,
          status: 'ACTIVE',
          lastSeenAt: new Date(),
        },
      });

      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'DEVICE_UPDATED',
          entityType: 'DEVICE',
          entityId: updated.id,
          result: 'SUCCESS',
        },
      });

      return updated;
    }

    const device = await this.prisma.device.create({
      data: {
        userId,
        deviceIdentifier: dto.deviceIdentifier,
        platform: dto.platform,
        appVersion: dto.appVersion,
        pushToken: dto.pushToken,
        status: 'ACTIVE',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'DEVICE_REGISTERED',
        entityType: 'DEVICE',
        entityId: device.id,
        result: 'SUCCESS',
      },
    });

    return device;
  }

  async revokeDevice(deviceId: string, actorUserId: string, actorRole: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    // Ownership & Permission check
    const isOwner = device.userId === actorUserId;
    const isAdmin = actorRole === 'ADMIN' || actorRole === 'SUPER_ADMIN';

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException({
        code: 'DEVICE_OWNERSHIP_REQUIRED',
        message: 'You are not authorized to revoke this device',
      });
    }

    // Mark device status as REVOKED
    const updated = await this.prisma.device.update({
      where: { id: deviceId },
      data: { status: 'REVOKED' },
    });

    // Revoke all sessions tied to this device
    const sessions = await this.prisma.session.findMany({
      where: { deviceId, isRevoked: false },
    });

    for (const s of sessions) {
      await this.redis.setRevocation(`revoked:session:${s.id}`, 900);
    }

    await this.prisma.session.updateMany({
      where: { deviceId, isRevoked: false },
      data: { isRevoked: true },
    });

    // Publish WebSocket revocation event via Redis
    await this.redis.publish(
      'security:revocation',
      JSON.stringify({
        type: 'DEVICE_REVOKED',
        deviceId,
        userId: device.userId,
      }),
    );

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'DEVICE_REVOKED',
        entityType: 'DEVICE',
        entityId: deviceId,
        result: 'SUCCESS',
      },
    });

    return { revoked: true, deviceId: updated.id };
  }

  async getUserDevices(userId: string) {
    return this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

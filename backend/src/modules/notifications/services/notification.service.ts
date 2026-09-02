import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { FcmNotificationProvider } from '../providers/fcm-notification.provider';
import { RegisterPushTokenDto } from '../dto/register-push-token.dto';
import { GetNotificationsQueryDto } from '../dto/get-notifications-query.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcmProvider: FcmNotificationProvider,
  ) {}

  async registerPushToken(dto: RegisterPushTokenDto, actorUserId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: dto.deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'DEVICE_NOT_FOUND',
        message: `Device with ID ${dto.deviceId} not found`,
      });
    }

    if (device.userId !== actorUserId) {
      throw new ForbiddenException({
        code: 'DEVICE_OWNERSHIP_REQUIRED',
        message: 'You do not own this device',
      });
    }

    const updated = await this.prisma.device.update({
      where: { id: dto.deviceId },
      data: {
        pushToken: dto.pushToken,
        status: 'ACTIVE',
        lastSeenAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'PUSH_TOKEN_REGISTERED',
        entityType: 'DEVICE',
        entityId: dto.deviceId,
        result: 'SUCCESS',
      },
    });

    return {
      deviceId: updated.id,
      pushTokenRegistered: true,
    };
  }

  async sendOperationalNotification(
    targetUserId: string,
    type: string,
    title: string,
    body: string,
    payloadJson: Record<string, any> = {},
  ) {
    // 1. Create Notification record in DB
    const notif = await this.prisma.notification.create({
      data: {
        userId: targetUserId,
        type,
        title,
        body,
        payloadJson: payloadJson as unknown as Prisma.InputJsonValue,
        provider: 'FCM',
        status: 'QUEUED',
      },
    });

    // 2. Fetch active non-revoked devices with push tokens
    const activeDevices = await this.prisma.device.findMany({
      where: {
        userId: targetUserId,
        status: 'ACTIVE',
        pushToken: { not: null },
      },
      select: { id: true, pushToken: true },
    });

    const validTokens = activeDevices
      .map((d) => d.pushToken)
      .filter((t): t is string => t !== null && t.length > 0);

    if (validTokens.length > 0) {
      const pushResult = await this.fcmProvider.sendPushNotification(validTokens, {
        title,
        body,
        type,
        payloadJson,
      });

      // 3. Stale token cleanup: clear pushToken if FCM returns invalid/unregistered
      if (pushResult.invalidTokens.length > 0) {
        await this.prisma.device.updateMany({
          where: { pushToken: { in: pushResult.invalidTokens } },
          data: { pushToken: null },
        });
        this.logger.log(`Cleared ${pushResult.invalidTokens.length} stale push token(s)`);
      }

      // 4. Update Notification status to SENT
      const updatedNotif = await this.prisma.notification.update({
        where: { id: notif.id },
        data: { status: 'SENT' },
      });
      return updatedNotif;
    }

    return notif;
  }

  async getUserNotifications(actorUserId: string, query: GetNotificationsQueryDto) {
    const limit = query.limit || 20;
    const offset = query.offset || 0;

    const notifications = await this.prisma.notification.findMany({
      where: { userId: actorUserId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await this.prisma.notification.count({
      where: { userId: actorUserId },
    });

    return {
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        payloadJson: n.payloadJson,
        status: n.status,
        createdAt: n.createdAt,
      })),
      pagination: { limit, offset, total },
    };
  }

  async markAsRead(notificationId: string, actorUserId: string) {
    const notif = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notif) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      });
    }

    if (notif.userId !== actorUserId) {
      throw new ForbiddenException({
        code: 'RESOURCE_FORBIDDEN',
        message: 'You are not authorized to modify this notification',
      });
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'READ' },
    });

    return updated;
  }
}

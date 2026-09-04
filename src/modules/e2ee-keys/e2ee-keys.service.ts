import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RegisterDeviceKeysDto } from './dto/register-device-keys.dto';
import { UploadPrekeysDto } from './dto/upload-prekeys.dto';

@Injectable()
export class E2eeKeysService {
  private readonly logger = new Logger(E2eeKeysService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerDeviceKeys(dto: RegisterDeviceKeysDto, actorUserId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: dto.deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (device.userId !== actorUserId) {
      throw new ForbiddenException({
        code: 'DEVICE_OWNERSHIP_REQUIRED',
        message: 'You do not own this device',
      });
    }

    const deviceKey = await this.prisma.deviceKey.upsert({
      where: { deviceId: dto.deviceId },
      update: {
        identityKeyPublic: dto.identityKeyPublic,
        signedPrekeyPublic: dto.signedPrekeyPublic,
        signedPrekeySig: dto.signedPrekeySig,
      },
      create: {
        deviceId: dto.deviceId,
        identityKeyPublic: dto.identityKeyPublic,
        signedPrekeyPublic: dto.signedPrekeyPublic,
        signedPrekeySig: dto.signedPrekeySig,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'E2EE_KEYS_REGISTERED',
        entityType: 'DEVICE_KEY',
        entityId: deviceKey.id,
        result: 'SUCCESS',
      },
    });

    return {
      deviceId: deviceKey.deviceId,
      identityKeyPublic: deviceKey.identityKeyPublic,
      signedPrekeyPublic: deviceKey.signedPrekeyPublic,
    };
  }

  async uploadPrekeys(dto: UploadPrekeysDto, actorUserId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: dto.deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (device.userId !== actorUserId) {
      throw new ForbiddenException({
        code: 'DEVICE_OWNERSHIP_REQUIRED',
        message: 'You do not own this device',
      });
    }

    // Insert batch of one-time prekeys
    const data = dto.prekeys.map((p) => ({
      deviceId: dto.deviceId,
      keyId: p.keyId,
      publicKey: p.publicKey,
    }));

    await this.prisma.prekey.createMany({
      data,
      skipDuplicates: true,
    });

    const totalAvailable = await this.prisma.prekey.count({
      where: { deviceId: dto.deviceId, isConsumed: false },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'PREKEY_BATCH_UPLOADED',
        entityType: 'PREKEY',
        entityId: dto.deviceId,
        result: 'SUCCESS',
        afterJson: {
          uploadedCount: dto.prekeys.length,
          totalAvailable,
        },
      },
    });

    return {
      deviceId: dto.deviceId,
      uploadedCount: dto.prekeys.length,
      totalAvailable,
    };
  }

  async consumePrekeyBundle(targetDeviceId: string) {
    const deviceKey = await this.prisma.deviceKey.findUnique({
      where: { deviceId: targetDeviceId },
    });

    if (!deviceKey) {
      throw new NotFoundException('E2EE Keys not found for this device');
    }

    // Atomically claim 1 one-time prekey using SELECT FOR UPDATE SKIP LOCKED
    const consumedPrekey: Array<{ id: string; key_id: number; public_key: string }> =
      await this.prisma.$queryRaw`
        UPDATE prekeys
        SET is_consumed = TRUE, consumed_at = NOW()
        WHERE id = (
          SELECT id FROM prekeys
          WHERE device_id = ${targetDeviceId}::uuid AND is_consumed = FALSE
          ORDER BY key_id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, key_id, public_key;
      `;

    const oneTimePrekey =
      consumedPrekey.length > 0
        ? {
            keyId: consumedPrekey[0].key_id,
            publicKey: consumedPrekey[0].public_key,
          }
        : null;

    // Check low-water mark for logging/alerting
    const remainingCount = await this.prisma.prekey.count({
      where: { deviceId: targetDeviceId, isConsumed: false },
    });

    if (remainingCount < 20) {
      this.logger.warn(`Device ${targetDeviceId} prekeys low-water warning: only ${remainingCount} left`);
    }

    // PRIVACY BOUNDARY: Return ONLY public cryptographic material
    return {
      deviceId: targetDeviceId,
      identityKeyPublic: deviceKey.identityKeyPublic,
      signedPrekeyPublic: deviceKey.signedPrekeyPublic,
      signedPrekeySig: deviceKey.signedPrekeySig,
      oneTimePrekey,
    };
  }

  async getPrekeyStatus(deviceId: string, actorUserId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (device.userId !== actorUserId) {
      throw new ForbiddenException({
        code: 'DEVICE_OWNERSHIP_REQUIRED',
        message: 'You do not own this device',
      });
    }

    const availablePrekeysCount = await this.prisma.prekey.count({
      where: { deviceId, isConsumed: false },
    });

    return {
      deviceId,
      availablePrekeysCount,
      isDepleted: availablePrekeysCount < 20,
    };
  }
}

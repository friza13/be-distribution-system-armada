import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { hashPassword } from '../../common/utils/password.util';
import { AccountStatus } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: { permission: true },
            },
          },
        },
        driver: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      status: user.status,
      role: user.role.code,
      permissions: user.role.rolePermissions.map((rp) => rp.permission.code),
      driver: user.driver || null,
      createdAt: user.createdAt,
    };
  }

  async updateUserRole(targetUserId: string, newRoleCode: string, actorUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const newRole = await this.prisma.role.findUnique({
      where: { code: newRoleCode },
    });

    if (!newRole) {
      throw new BadRequestException(`Role ${newRoleCode} does not exist`);
    }

    const previousRole = user.role.code;

    // Update role in DB
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { roleId: newRole.id },
      include: { role: true },
    });

    // Revoke all active sessions for this user in DB
    await this.prisma.session.updateMany({
      where: { userId: targetUserId, isRevoked: false },
      data: { isRevoked: true },
    });

    // Write Redis user revocation key (TTL 15m) so JwtAuthGuard rejects older tokens immediately
    await this.redis.setRevocation(`revoked:user:${targetUserId}`, 900);

    // Audit Log
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'ROLE_CHANGED',
        entityType: 'USER',
        entityId: targetUserId,
        result: 'SUCCESS',
        beforeJson: { role: previousRole },
        afterJson: { role: newRole.code },
      },
    });

    return {
      id: updated.id,
      username: updated.username,
      role: updated.role.code,
    };
  }

  async updateUserStatus(targetUserId: string, status: AccountStatus, actorUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const previousStatus = user.status;

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status },
    });

    if (status === 'SUSPENDED' || status === 'DISABLED') {
      // Revoke all sessions in DB
      await this.prisma.session.updateMany({
        where: { userId: targetUserId, isRevoked: false },
        data: { isRevoked: true },
      });

      // Write Redis revocation key
      await this.redis.setRevocation(`revoked:user:${targetUserId}`, 900);

      // Publish Realtime revocation event
      await this.redis.publish(
        'security:revocation',
        JSON.stringify({
          type: 'USER_REVOKED',
          userId: targetUserId,
          reason: `ACCOUNT_${status}`,
        }),
      );
    }

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'ACCOUNT_STATUS_CHANGED',
        entityType: 'USER',
        entityId: targetUserId,
        result: 'SUCCESS',
        beforeJson: { status: previousStatus },
        afterJson: { status },
      },
    });

    return {
      id: updated.id,
      username: updated.username,
      status: updated.status,
    };
  }

  async adminResetPassword(targetUserId: string, newPass: string, actorUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const passwordHash = await hashPassword(newPass);

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { passwordHash },
    });

    // Revoke all active sessions
    await this.prisma.session.updateMany({
      where: { userId: targetUserId, isRevoked: false },
      data: { isRevoked: true },
    });
    await this.redis.setRevocation(`revoked:user:${targetUserId}`, 900);

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'ADMIN_PASSWORD_RESET',
        entityType: 'USER',
        entityId: targetUserId,
        result: 'SUCCESS',
      },
    });

    return { reset: true, userId: targetUserId };
  }
}

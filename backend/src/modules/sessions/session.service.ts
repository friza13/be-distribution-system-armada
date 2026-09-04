import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { hashToken, generateSecureToken } from '../../common/utils/token.util';
import { v4 as uuidv4 } from 'uuid';

class RefreshTokenReuseError extends Error {
  constructor(readonly session: any) {
    super('Refresh token reuse detected');
  }
}

export interface SessionResult {
  sessionId: string;
  tokenFamily: string;
  rawRefreshToken: string;
  deviceId: string;
  userId: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async createSession(
    userId: string,
    deviceId: string,
    roleCode: string,
  ): Promise<SessionResult> {
    const rawRefreshToken = generateSecureToken(32);
    const refreshTokenHash = hashToken(rawRefreshToken);
    const tokenFamily = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Driver Single Active Session Concurrency Lock
    if (roleCode === 'DRIVER') {
      return await this.prisma.$transaction(async (tx) => {
        // Pessimistic lock on user row to serialize concurrent driver logins
        await tx.$executeRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE;`;

        // Find active sessions to revoke
        const existingSessions = await tx.session.findMany({
          where: { userId, isRevoked: false },
        });

        for (const s of existingSessions) {
          await this.redis.setRevocation(`revoked:session:${s.id}`, 900);
        }

        // Revoke all previous active sessions in DB
        await tx.session.updateMany({
          where: { userId, isRevoked: false },
          data: { isRevoked: true },
        });

        // Create the single new session
        const session = await tx.session.create({
          data: {
            userId,
            deviceId,
            refreshTokenHash,
            tokenFamily,
            isRevoked: false,
            expiresAt,
          },
        });

        return {
          sessionId: session.id,
          tokenFamily: session.tokenFamily,
          rawRefreshToken,
          deviceId: session.deviceId,
          userId: session.userId,
        };
      });
    }

    // Owner / Admin Policy: Max 5 Concurrent Sessions (FIFO Eviction)
    const activeSessions = await this.prisma.session.findMany({
      where: { userId, isRevoked: false },
      orderBy: { lastRefreshedAt: 'asc' },
    });

    if (activeSessions.length >= 5) {
      const sessionsToEvict = activeSessions.slice(0, activeSessions.length - 4);
      for (const s of sessionsToEvict) {
        await this.prisma.session.update({
          where: { id: s.id },
          data: { isRevoked: true },
        });
        await this.redis.setRevocation(`revoked:session:${s.id}`, 900);
      }
    }

    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceId,
        refreshTokenHash,
        tokenFamily,
        isRevoked: false,
        expiresAt,
      },
    });

    return {
      sessionId: session.id,
      tokenFamily: session.tokenFamily,
      rawRefreshToken,
      deviceId: session.deviceId,
      userId: session.userId,
    };
  }

  async rotateSession(rawRefreshToken: string): Promise<SessionResult> {
    const hashed = hashToken(rawRefreshToken);

    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const existingSession = await tx.session.findFirst({
          where: { refreshTokenHash: hashed },
          include: { user: { include: { role: true } } },
        });

        if (!existingSession) {
          throw new UnauthorizedException({
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Invalid or expired refresh token',
          });
        }

        if (existingSession.isRevoked || existingSession.expiresAt <= new Date()) {
          throw new RefreshTokenReuseError(existingSession);
        }

        const newRawRefreshToken = generateSecureToken(32);
        const newRefreshTokenHash = hashToken(newRawRefreshToken);
        const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // Compare-and-set prevents two concurrent requests from rotating the same row.
        const claimed = await tx.session.updateMany({
          where: { id: existingSession.id, isRevoked: false },
          data: { isRevoked: true, lastRefreshedAt: new Date() },
        });

        if (claimed.count !== 1) {
          throw new RefreshTokenReuseError(existingSession);
        }

        const newSession = await tx.session.create({
          data: {
            userId: existingSession.userId,
            deviceId: existingSession.deviceId,
            refreshTokenHash: newRefreshTokenHash,
            tokenFamily: existingSession.tokenFamily,
            isRevoked: false,
            expiresAt: newExpiresAt,
          },
        });

        return {
          sessionId: newSession.id,
          tokenFamily: newSession.tokenFamily,
          rawRefreshToken: newRawRefreshToken,
          deviceId: newSession.deviceId,
          userId: newSession.userId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof RefreshTokenReuseError) {
        await this.revokeTokenFamily(err.session);
        throw new UnauthorizedException({
          code: 'TOKEN_REUSE_DETECTED',
          message: 'Refresh token reuse detected. All sessions in family have been revoked.',
        });
      }
      throw err;
    }
  }

  private async revokeTokenFamily(session: any): Promise<void> {
    this.logger.warn(
      `Token reuse detected for user ${session.userId}, family: ${session.tokenFamily}`,
    );

    await this.prisma.session.updateMany({
      where: { tokenFamily: session.tokenFamily },
      data: { isRevoked: true },
    });

    await this.redis.setRevocation(`revoked:session:${session.id}`, 900);
    await this.redis.setRevocation(`revoked:user:${session.userId}`, 900);

    await this.redis.publish(
      'security:revocation',
      JSON.stringify({
        type: 'USER_REVOKED',
        userId: session.userId,
        sessionId: session.id,
        reason: 'TOKEN_REUSE_DETECTED',
        timestamp: new Date().toISOString(),
      }),
    );

    await this.prisma.auditLog.create({
      data: {
        actorUserId: session.userId,
        action: 'TOKEN_REUSE_DETECTED',
        entityType: 'SESSION',
        entityId: session.id,
        result: 'FAILED',
        afterJson: {
          tokenFamily: session.tokenFamily,
          revokedAt: new Date().toISOString(),
        },
      },
    });
  }

  async revokeSession(sessionId?: string, userId?: string): Promise<void> {
    if (!sessionId) {
      this.logger.debug('revokeSession called with empty or undefined sessionId, skipping');
      return;
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || (userId && session.userId !== userId)) {
      return;
    }

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { isRevoked: true },
    });

    await this.redis.setRevocation(`revoked:session:${sessionId}`, 900);

    // Publish Realtime revocation event
    await this.redis.publish(
      'security:revocation',
      JSON.stringify({
        type: 'SESSION_REVOKED',
        sessionId,
        userId: session.userId,
        reason: 'USER_LOGOUT',
        timestamp: new Date().toISOString(),
      }),
    );
  }

  async revokeAllUserSessions(userId?: string): Promise<void> {
    if (!userId) {
      this.logger.debug('revokeAllUserSessions called with empty or undefined userId, skipping');
      return;
    }

    await this.prisma.session.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });

    await this.redis.setRevocation(`revoked:user:${userId}`, 900);

    // Publish Realtime revocation event
    await this.redis.publish(
      'security:revocation',
      JSON.stringify({
        type: 'USER_REVOKED',
        userId,
        reason: 'LOGOUT_ALL_SESSIONS',
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { TurnCredentialService } from './turn-credential.service';
import { InitiateCallDto } from '../dto/initiate-call.dto';
import { RealtimeGateway } from '../../realtime/gateways/realtime.gateway';
import { formatRealtimeEvent } from '../../realtime/dto/realtime-envelope.dto';
import { RealtimeSessionType, RealtimeSessionStatus } from '@prisma/client';

export interface UserActor {
  userId: string;
  role: string;
  driverId?: string | null;
  deviceId?: string;
}

@Injectable()
export class CallSessionService {
  private readonly logger = new Logger(CallSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly turnCredentialService: TurnCredentialService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async initiateCallSession(dto: InitiateCallDto, actor: UserActor) {
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Owner or Admin can initiate a call session to a Driver',
      });
    }

    // Rate Limit: Max 3 call invites per 60 seconds per user
    const rateCount = await this.redisService.incrRateLimit(
      `throttle:call:invite:${actor.userId}`,
      60,
    );
    if (rateCount > 3) {
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Call invitation rate limit exceeded (Max 3 invites/min).',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const driver = await this.prisma.driver.findUnique({
      where: { id: dto.driverId },
      include: { user: true },
    });

    if (!driver) {
      throw new NotFoundException({
        code: 'DRIVER_NOT_FOUND',
        message: `Driver with ID ${dto.driverId} not found`,
      });
    }

    // Generate Ephemeral TURN Credentials (RFC 7635)
    const turnCredentials = this.turnCredentialService.generateEphemeralCredentials(actor.userId, 3600);

    const pendingTimeoutMs = 30000; // 30 seconds call invite timeout
    const expiresAt = new Date(Date.now() + pendingTimeoutMs);

    const session = await this.prisma.realtimeSession.create({
      data: {
        type: dto.type,
        ownerId: actor.userId,
        driverId: dto.driverId,
        deliveryId: dto.deliveryId || null,
        status: 'PENDING',
        expiresAt,
      },
    });

    // Schedule 30s pending call watchdog timeout
    setTimeout(async () => {
      await this.handlePendingTimeout(session.id);
    }, pendingTimeoutMs);

    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: dto.type === 'VOICE_PTT' ? 'VOICE_SESSION_STARTED' : 'VIDEO_REQUESTED',
        entityType: 'REALTIME_SESSION',
        entityId: session.id,
        result: 'SUCCESS',
      },
    });

    // Broadcast call invitation via WebSocket
    this.broadcastCallInvite(session.id, dto.driverId, dto.type, actor, turnCredentials);

    return {
      sessionId: session.id,
      type: session.type,
      ownerId: session.ownerId,
      driverId: session.driverId,
      deliveryId: session.deliveryId,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      turnCredentials,
    };
  }

  async respondToCallSession(sessionId: string, action: 'ACCEPT' | 'DECLINE', actor: UserActor) {
    const session = await this.prisma.realtimeSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException({
        code: 'CALL_SESSION_NOT_FOUND',
        message: `Call session ${sessionId} not found`,
      });
    }

    // IDOR Check: Callee Driver verification
    if (actor.role === 'DRIVER') {
      if (!actor.driverId || session.driverId !== actor.driverId) {
        throw new ForbiddenException({
          code: 'RESOURCE_FORBIDDEN',
          message: 'You are not the designated recipient for this call session',
        });
      }
    }

    if (session.status !== 'PENDING') {
      throw new ConflictException({
        code: 'INVALID_CALL_STATE',
        message: `Cannot respond to call in status ${session.status}. Expected PENDING`,
      });
    }

    const newStatus: RealtimeSessionStatus = action === 'ACCEPT' ? 'ACTIVE' : 'DECLINED';
    const now = new Date();

    const updated = await this.prisma.realtimeSession.update({
      where: { id: sessionId },
      data: {
        status: newStatus,
        startedAt: action === 'ACCEPT' ? now : null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: action === 'ACCEPT' ? 'VIDEO_ACCEPTED' : 'VIDEO_DECLINED',
        entityType: 'REALTIME_SESSION',
        entityId: sessionId,
        result: 'SUCCESS',
      },
    });

    // Broadcast call response to caller / session participants
    this.broadcastCallResponded(session.id, newStatus, actor);

    return updated;
  }

  async endCallSession(sessionId: string, actor: UserActor) {
    const session = await this.prisma.realtimeSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException({
        code: 'CALL_SESSION_NOT_FOUND',
        message: `Call session ${sessionId} not found`,
      });
    }

    if (session.status === 'ENDED') {
      return session;
    }

    const updated = await this.prisma.realtimeSession.update({
      where: { id: sessionId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'CALL_SESSION_ENDED',
        entityType: 'REALTIME_SESSION',
        entityId: sessionId,
        result: 'SUCCESS',
      },
    });

    this.broadcastCallEnded(session.id, 'USER_HANGUP', actor);

    return updated;
  }

  private async handlePendingTimeout(sessionId: string) {
    try {
      const session = await this.prisma.realtimeSession.findUnique({ where: { id: sessionId } });
      if (session && session.status === 'PENDING') {
        await this.prisma.realtimeSession.update({
          where: { id: sessionId },
          data: { status: 'TIMEOUT' },
        });

        this.logger.log(`Call session ${sessionId} timed out after 30s unanswered`);
        this.broadcastCallEnded(sessionId, 'TIMEOUT', { userId: session.ownerId, role: 'SYSTEM' });
      }
    } catch (err: unknown) {
      this.logger.warn(`Failed to process call timeout for ${sessionId}: ${err}`);
    }
  }

  private broadcastCallInvite(sessionId: string, driverId: string, type: RealtimeSessionType, actor: UserActor, turnCredentials: any) {
    if (this.realtimeGateway && this.realtimeGateway.server) {
      const envelope = formatRealtimeEvent(
        'webrtc.call.invite',
        { sessionId, type, driverId, turnCredentials },
        { userId: actor.userId, role: actor.role, driverId: actor.driverId || null },
      );
      this.realtimeGateway.server.to(`driver:${driverId}`).emit('webrtc.call.invite', envelope);
    }
  }

  private broadcastCallResponded(sessionId: string, status: RealtimeSessionStatus, actor: UserActor) {
    if (this.realtimeGateway && this.realtimeGateway.server) {
      const envelope = formatRealtimeEvent(
        'webrtc.call.respond',
        { sessionId, status },
        { userId: actor.userId, role: actor.role, driverId: actor.driverId || null },
      );
      this.realtimeGateway.server.to(`session:${sessionId}`).emit('webrtc.call.respond', envelope);
    }
  }

  private broadcastCallEnded(sessionId: string, reason: string, actor: UserActor) {
    if (this.realtimeGateway && this.realtimeGateway.server) {
      const envelope = formatRealtimeEvent(
        'webrtc.call.ended',
        { sessionId, status: 'ENDED', reason },
        { userId: actor.userId, role: actor.role, driverId: actor.driverId || null },
      );
      this.realtimeGateway.server.to(`session:${sessionId}`).emit('webrtc.call.ended', envelope);
    }
  }
}

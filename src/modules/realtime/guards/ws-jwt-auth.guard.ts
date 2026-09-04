import { Injectable, Logger, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

export interface AuthenticatedSocketData {
  userId: string;
  username: string;
  role: string;
  permissions: string[];
  deviceId: string;
  sessionId: string;
  accessTokenExp: number;
  driverId: string | null;
  connectedAt: Date;
  joinedRooms: Set<string>;
  lastPingSentAt?: number;
  lastPongReceivedAt?: number;
  rttLatencyMs?: number;
  heartbeatIntervalTimer?: NodeJS.Timeout;
  pongTimeoutTimer?: NodeJS.Timeout;
}

export interface WsJwtPayload {
  sub: string;
  role: string;
  deviceId: string;
  sessionId: string;
  type: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtAuthGuard.name);
  private readonly jwtSecret: string;
  private readonly previousSecret?: string;
  private readonly currentKeyId: string;
  private readonly previousKeyId?: string;
  private readonly jwtIssuer: string;
  private readonly jwtAudience: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.jwtSecret = this.configService.get<string>(
      'jwt.secretOrKey',
      'default_long_secret_key_32_characters!',
    );
    this.previousSecret = this.configService.get<string>('jwt.previousSecretOrKey');
    this.currentKeyId = process.env.JWT_CURRENT_KEY_ID || 'dms-2026-q3';
    this.previousKeyId = process.env.JWT_PREVIOUS_KEY_ID;
    this.jwtIssuer = this.configService.get<string>('jwt.issuer', 'dms-api');
    this.jwtAudience = this.configService.get<string>('jwt.audience', 'dms-clients');
  }

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();
    if (!client.data || !client.data.userId) {
      throw new WsException('UNAUTHORIZED: Authentication required');
    }
    return true;
  }

  async validateHandshake(socket: Socket): Promise<AuthenticatedSocketData> {
    const rawToken = this.extractToken(socket);
    if (!rawToken) {
      throw new Error('UNAUTHORIZED: Token required');
    }

    let decodedHeader: jwt.JwtHeader | null = null;
    try {
      const decoded = jwt.decode(rawToken, { complete: true });
      if (!decoded || typeof decoded !== 'object') {
        throw new Error('UNAUTHORIZED: Invalid token format');
      }
      decodedHeader = decoded.header;
    } catch {
      throw new Error('UNAUTHORIZED: Invalid token format');
    }

    if (!decodedHeader || decodedHeader.alg !== 'HS256') {
      throw new Error('UNAUTHORIZED: Invalid token algorithm');
    }

    let secretToUse = this.jwtSecret;
    if (
      decodedHeader.kid &&
      this.previousKeyId &&
      decodedHeader.kid === this.previousKeyId &&
      this.previousSecret
    ) {
      secretToUse = this.previousSecret;
    }

    let payload: WsJwtPayload;
    try {
      payload = jwt.verify(rawToken, secretToUse, {
        algorithms: ['HS256'],
        issuer: this.jwtIssuer,
        audience: this.jwtAudience,
      }) as WsJwtPayload;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('expired')) {
        throw new Error('UNAUTHORIZED: Token expired');
      }
      if (message.includes('issuer')) {
        throw new Error('UNAUTHORIZED: Invalid issuer');
      }
      if (message.includes('audience')) {
        throw new Error('UNAUTHORIZED: Invalid audience');
      }
      throw new Error('UNAUTHORIZED: Invalid signature');
    }

    if (payload.type !== 'ACCESS_TOKEN') {
      throw new Error('UNAUTHORIZED: Invalid token type');
    }

    if (!payload.sessionId || !payload.sub || !payload.deviceId || !Number.isFinite(payload.exp)) {
      throw new Error('UNAUTHORIZED: Incomplete token claims');
    }

    const isSessionRevoked = await this.redis.isRevoked(
      `revoked:session:${payload.sessionId}`,
    );
    if (isSessionRevoked === true) {
      throw new Error('UNAUTHORIZED: Session revoked');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
        driver: true,
      },
    });

    if (!user) {
      throw new Error('UNAUTHORIZED: User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new Error(`UNAUTHORIZED: Account ${user.status.toLowerCase()}`);
    }

    if (user.role.code !== payload.role) {
      throw new Error('UNAUTHORIZED: ROLE_UPDATED_REAUTH_REQUIRED');
    }

    if (isSessionRevoked === false || isSessionRevoked === null) {
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sessionId },
        select: {
          userId: true,
          deviceId: true,
          isRevoked: true,
          expiresAt: true,
          device: { select: { userId: true, status: true } },
        },
      });

      if (
        !session ||
        session.userId !== payload.sub ||
        session.deviceId !== payload.deviceId ||
        session.device.userId !== payload.sub ||
        session.isRevoked ||
        session.expiresAt <= new Date() ||
        session.device.status !== 'ACTIVE'
      ) {
        throw new Error('UNAUTHORIZED: Session revoked');
      }
    }

    const isUserRevoked = await this.redis.isRevoked(
      `revoked:user:${payload.sub}`,
    );
    if (isUserRevoked === true) {
      throw new Error('UNAUTHORIZED: User revoked');
    }

    const permissions = user.role.rolePermissions.map((rp) => rp.permission.code);

    const socketData: AuthenticatedSocketData = {
      userId: user.id,
      username: user.username,
      role: user.role.code,
      permissions,
      deviceId: payload.deviceId,
      sessionId: payload.sessionId,
      accessTokenExp: payload.exp,
      driverId: user.driver?.id || null,
      connectedAt: new Date(),
      joinedRooms: new Set<string>(),
    };

    socket.data = socketData;
    return socketData;
  }

  async validateSocket(socket: Socket): Promise<void> {
    const data = socket.data as AuthenticatedSocketData;
    if (!data?.userId || !data.sessionId || !data.deviceId) {
      throw new Error('UNAUTHORIZED: Authentication context required');
    }

    if (!Number.isFinite(data.accessTokenExp) || data.accessTokenExp <= Math.floor(Date.now() / 1000)) {
      throw new Error('UNAUTHORIZED: Access token expired');
    }

    const [session, user, isSessionRevoked, isUserRevoked] = await Promise.all([
      this.prisma.session.findUnique({
        where: { id: data.sessionId },
        select: {
          userId: true,
          deviceId: true,
          isRevoked: true,
          expiresAt: true,
          device: { select: { userId: true, status: true } },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: data.userId },
        select: { status: true, role: { select: { code: true } }, driver: { select: { id: true } } },
      }),
      this.redis.isRevoked(`revoked:session:${data.sessionId}`),
      this.redis.isRevoked(`revoked:user:${data.userId}`),
    ]);

    if (
      isSessionRevoked === true ||
      isUserRevoked === true ||
      !session ||
      !user ||
      user.status !== 'ACTIVE' ||
      user.role.code !== data.role ||
      session.userId !== data.userId ||
      session.deviceId !== data.deviceId ||
      session.device.userId !== data.userId ||
      session.isRevoked ||
      session.expiresAt <= new Date() ||
      session.device.status !== 'ACTIVE' ||
      (user.driver?.id || null) !== data.driverId
    ) {
      throw new Error('UNAUTHORIZED: Session or device revoked');
    }
  }

  private extractToken(socket: Socket): string | null {
    const authHeader =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization ||
      socket.handshake.query?.token;

    if (!authHeader || typeof authHeader !== 'string') {
      return null;
    }

    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }

    return authHeader.trim();
  }
}

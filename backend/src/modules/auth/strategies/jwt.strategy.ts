import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

export interface JwtPayload {
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
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secretOrKey', 'default_long_secret_key_32_characters!'),
      algorithms: ['HS256'],
      issuer: configService.get<string>('jwt.issuer', 'dms-api'),
      audience: configService.get<string>('jwt.audience', 'dms-clients'),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type !== 'ACCESS_TOKEN') {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN_TYPE',
        message: 'Invalid token type, expected ACCESS_TOKEN',
      });
    }

    // Fast memory check via Redis Revocation Cache
    const isSessionRevoked = await this.redis.isRevoked(
      `revoked:session:${payload.sessionId}`,
    );

    if (isSessionRevoked === true) {
      throw new UnauthorizedException({
        code: 'TOKEN_REVOKED',
        message: 'Token or session has been revoked',
      });
    }

    // Verify User in Database
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
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User no longer exists',
      });
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: `ACCOUNT_${user.status}`,
        message: `Account is ${user.status.toLowerCase()}`,
      });
    }

    // If user role was changed after token issuance -> demand reauth
    if (user.role.code !== payload.role) {
      throw new UnauthorizedException({
        code: 'ROLE_UPDATED_REAUTH_REQUIRED',
        message: 'User permissions or role have changed. Please re-authenticate.',
      });
    }

    const isUserRevoked = await this.redis.isRevoked(
      `revoked:user:${payload.sub}`,
    );

    if (isUserRevoked === true) {
      throw new UnauthorizedException({
        code: 'TOKEN_REVOKED',
        message: 'User tokens have been revoked',
      });
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
        throw new UnauthorizedException({
          code: 'TOKEN_REVOKED',
          message: 'Token or session has been revoked',
        });
      }
    }

    const permissions = user.role.rolePermissions.map((rp) => rp.permission.code);

    return {
      id: user.id,
      username: user.username,
      role: user.role.code,
      permissions,
      deviceId: payload.deviceId,
      sessionId: payload.sessionId,
      driverId: user.driver?.id || null,
    };
  }
}

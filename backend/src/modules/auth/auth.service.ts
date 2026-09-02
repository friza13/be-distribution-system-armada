import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SessionService } from '../sessions/session.service';
import {
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
  needsRehash,
} from '../../common/utils/password.util';
import { generateSecureToken } from '../../common/utils/token.util';
import { LoginDto, ClientType } from './dto/login.dto';
import { RegisterUserDto } from './dto/register-user.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly currentKeyId: string;
  private readonly jwtIssuer: string;
  private readonly jwtAudience: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
  ) {
    this.currentKeyId = process.env.JWT_CURRENT_KEY_ID || 'dms-2026-q3';
    this.jwtIssuer = this.configService.get<string>('jwt.issuer', 'dms-api');
    this.jwtAudience = this.configService.get<string>('jwt.audience', 'dms-clients');
  }

  async login(
    dto: LoginDto,
    clientIp: string,
    userAgent: string,
    res?: Response,
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: dto.username }, { email: dto.username }, { phone: dto.username }],
      },
      include: { role: true, driver: true },
    });

    if (!user) {
      await dummyVerifyPassword(dto.password);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: `ACCOUNT_${user.status}`,
        message: `Account is ${user.status.toLowerCase()}`,
      });
    }

    const isMatch = await verifyPassword(user.passwordHash, dto.password);
    if (!isMatch) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    // Transparent password rehash if parameters upgraded
    if (needsRehash(user.passwordHash)) {
      const newHash = await hashPassword(dto.password);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });
    }

    // Handle or create device record
    let deviceId = dto.deviceId;
    if (!deviceId) {
      const defaultDevice = await this.prisma.device.create({
        data: {
          userId: user.id,
          deviceIdentifier: `${dto.clientType || 'MOBILE'}-${Date.now()}`,
          platform: dto.clientType === ClientType.WEB ? 'WEB' : 'ANDROID',
          appVersion: '1.0.0',
        },
      });
      deviceId = defaultDevice.id;
    }

    // Create session (with Single Active Driver Lock if role is DRIVER)
    const sessionResult = await this.sessionService.createSession(
      user.id,
      deviceId,
      user.role.code,
    );

    // Sign Access Token (15m)
    const payload = {
      sub: user.id,
      role: user.role.code,
      deviceId,
      sessionId: sessionResult.sessionId,
      type: 'ACCESS_TOKEN',
    };

    const accessToken = this.jwtService.sign(payload, {
      algorithm: 'HS256',
      expiresIn: '15m',
      issuer: this.jwtIssuer,
      audience: this.jwtAudience,
      header: {
        alg: 'HS256',
        typ: 'JWT',
        kid: this.currentKeyId,
      },
    });

    // Update lastLoginAt & Audit Log
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'LOGIN_SUCCESS',
        entityType: 'USER',
        entityId: user.id,
        result: 'SUCCESS',
        ipAddress: clientIp,
        userAgent,
      },
    });

    // Dual Transport Strategy:
    if (dto.clientType === ClientType.WEB && res) {
      // Set HttpOnly Secure Cookie for Admin Web
      res.cookie('dms_refresh_token', sessionResult.rawRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/v1/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      return {
        accessToken,
        expiresIn: 900,
        user: {
          id: user.id,
          username: user.username,
          role: user.role.code,
          driverId: user.driver?.id || null,
        },
      };
    }

    // Mobile Strategy: Return Refresh Token in JSON Response
    return {
      accessToken,
      refreshToken: sessionResult.rawRefreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        username: user.username,
        role: user.role.code,
        driverId: user.driver?.id || null,
      },
    };
  }

  async refresh(
    rawRefreshToken: string,
    clientType: ClientType = ClientType.MOBILE,
    res?: Response,
  ) {
    if (!rawRefreshToken) {
      throw new UnauthorizedException({
        code: 'MISSING_REFRESH_TOKEN',
        message: 'Refresh token is required',
      });
    }

    const sessionResult = await this.sessionService.rotateSession(rawRefreshToken);
    const user = await this.prisma.user.findUnique({
      where: { id: sessionResult.userId },
      include: { role: true, driver: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message: 'Account is inactive',
      });
    }

    const payload = {
      sub: user.id,
      role: user.role.code,
      deviceId: sessionResult.deviceId,
      sessionId: sessionResult.sessionId,
      type: 'ACCESS_TOKEN',
    };

    const accessToken = this.jwtService.sign(payload, {
      algorithm: 'HS256',
      expiresIn: '15m',
      issuer: this.jwtIssuer,
      audience: this.jwtAudience,
      header: {
        alg: 'HS256',
        typ: 'JWT',
        kid: this.currentKeyId,
      },
    });

    if (clientType === ClientType.WEB && res) {
      res.cookie('dms_refresh_token', sessionResult.rawRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/v1/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return {
        accessToken,
        expiresIn: 900,
      };
    }

    return {
      accessToken,
      refreshToken: sessionResult.rawRefreshToken,
      expiresIn: 900,
    };
  }

  async logout(sessionId: string, userId: string, res?: Response) {
    await this.sessionService.revokeSession(sessionId, userId);
    if (res) {
      res.clearCookie('dms_refresh_token', { path: '/v1/auth' });
      res.clearCookie('dms_csrf_token', { path: '/' });
    }
    return { loggedOut: true };
  }

  async logoutAll(userId: string, res?: Response) {
    await this.sessionService.revokeAllUserSessions(userId);
    if (res) {
      res.clearCookie('dms_refresh_token', { path: '/v1/auth' });
      res.clearCookie('dms_csrf_token', { path: '/' });
    }
    return { loggedOutAll: true };
  }

  async registerUser(dto: RegisterUserDto) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: dto.username }, { phone: dto.phone }, ...(dto.email ? [{ email: dto.email }] : [])],
      },
    });

    if (existing) {
      throw new BadRequestException('User with this username, email, or phone already exists');
    }

    const role = await this.prisma.role.findUnique({
      where: { code: dto.roleCode },
    });

    if (!role) {
      throw new BadRequestException(`Role ${dto.roleCode} does not exist`);
    }

    const passwordHash = await hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        roleId: role.id,
        status: 'ACTIVE',
      },
      include: { role: true },
    });

    return {
      id: user.id,
      username: user.username,
      role: user.role.code,
      createdAt: user.createdAt,
    };
  }
}

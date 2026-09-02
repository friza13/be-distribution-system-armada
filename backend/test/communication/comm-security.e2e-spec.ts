import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RedisService } from '../../src/common/redis/redis.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Communication Security, Abuse Throttling & IDOR Defense (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  let ownerUser: any;
  let ownerDevice: any;
  let ownerSession: any;
  let ownerToken: string;

  let driverUserA: any;
  let driverEntityA: any;
  let driverDeviceA: any;
  let driverSessionA: any;
  let driverTokenA: string;

  let conversationA: any;

  const secretKey = 'test_secret_with_minimum_32_characters_length_here';
  const issuer = 'dms-api';
  const audience = 'dms-clients';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    const ownerRole = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    const driverRole = await prisma.role.upsert({
      where: { code: 'DRIVER' },
      update: {},
      create: { code: 'DRIVER', name: 'Driver' },
    });

    ownerUser = await prisma.user.create({
      data: {
        username: `sec_own_${Date.now()}`,
        phone: `+62818${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });
    ownerDevice = await prisma.device.create({
      data: { userId: ownerUser.id, deviceIdentifier: `own-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    ownerSession = await prisma.session.create({
      data: { userId: ownerUser.id, deviceId: ownerDevice.id, refreshTokenHash: 'h_own', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    ownerToken = jwt.sign(
      { sub: ownerUser.id, role: 'OWNER', deviceId: ownerDevice.id, sessionId: ownerSession.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    driverUserA = await prisma.user.create({
      data: {
        username: `sec_drv_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-SEC-${Date.now()}`, displayName: 'Security Driver', phone: driverUserA.phone },
    });
    driverDeviceA = await prisma.device.create({
      data: { userId: driverUserA.id, deviceIdentifier: `drva-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSessionA = await prisma.session.create({
      data: { userId: driverUserA.id, deviceId: driverDeviceA.id, refreshTokenHash: 'h_drva', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverTokenA = jwt.sign(
      { sub: driverUserA.id, role: 'DRIVER', deviceId: driverDeviceA.id, sessionId: driverSessionA.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    conversationA = await prisma.conversation.create({
      data: { ownerId: ownerUser.id, driverId: driverEntityA.id },
    });
  });

  afterAll(async () => {
    if (conversationA) {
      await prisma.message.deleteMany({ where: { conversationId: conversationA.id } });
      await prisma.conversation.deleteMany({ where: { id: conversationA.id } });
    }
    await prisma.realtimeSession.deleteMany({ where: { ownerId: ownerUser.id } });
    if (driverUserA) {
      await prisma.driver.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.session.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.device.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.user.delete({ where: { id: driverUserA.id } });
    }
    if (ownerUser) {
      await prisma.session.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.device.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.user.delete({ where: { id: ownerUser.id } });
    }
    await app.close();
  });

  beforeEach(async () => {
    await redis.resetRateLimit(`throttle:chat:send:${ownerUser.id}`);
    await redis.resetRateLimit(`throttle:call:invite:${ownerUser.id}`);
  });

  it('should enforce 10 messages/sec rate limit for chat send', async () => {
    const payload = {
      recipientDeviceId: driverDeviceA.id,
      protocolVersion: 1,
      ciphertextBlob: 'EncryptedBlobTest',
      headerJson: {},
    };

    // Send 10 rapid messages
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post(`/v1/conversations/${conversationA.id}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload)
        .expect(HttpStatus.CREATED);
    }

    // 11th request within 1s should be rejected with 429 Too Many Requests
    const res = await request(app.getHttpServer())
      .post(`/v1/conversations/${conversationA.id}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload)
      .expect(HttpStatus.TOO_MANY_REQUESTS);

    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should enforce 3 call invites/min rate limit for voice call initiation', async () => {
    const payload = {
      driverId: driverEntityA.id,
      type: 'VOICE_PTT',
    };

    // Initiate 3 calls
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/v1/voice-sessions')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload)
        .expect(HttpStatus.CREATED);
    }

    // 4th call attempt within 1min should be rejected with 429 Too Many Requests
    const res = await request(app.getHttpServer())
      .post('/v1/voice-sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload)
      .expect(HttpStatus.TOO_MANY_REQUESTS);

    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should verify audit logs contain zero TURN secrets or plaintext private communication content', async () => {
    const logs = await prisma.auditLog.findMany({
      where: {
        action: { in: ['VOICE_SESSION_STARTED', 'VIDEO_REQUESTED', 'CONVERSATION_CREATED'] },
      },
      take: 10,
    });

    expect(logs.length).toBeGreaterThan(0);
    logs.forEach((log) => {
      const logString = JSON.stringify(log);
      expect(logString).not.toContain('test_turn_secret');
      expect(logString).not.toContain('EncryptedBlobTest');
    });
  });
});

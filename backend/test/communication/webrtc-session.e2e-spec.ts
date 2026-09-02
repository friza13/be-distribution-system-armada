import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('WebRTC Call Session State Machine & TURN Credentials (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerUser: any;
  let ownerDevice: any;
  let ownerSession: any;
  let ownerToken: string;

  let driverUserA: any;
  let driverEntityA: any;
  let driverDeviceA: any;
  let driverSessionA: any;
  let driverTokenA: string;

  let driverUserB: any;
  let driverEntityB: any;
  let driverDeviceB: any;
  let driverSessionB: any;
  let driverTokenB: string;

  let voiceSessionId: string;
  let videoSessionId: string;

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
        username: `rtc_own_${Date.now()}`,
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
        username: `rtc_drv_a_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-RTC-A-${Date.now()}`, displayName: 'Driver RTC A', phone: driverUserA.phone },
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

    driverUserB = await prisma.user.create({
      data: {
        username: `rtc_drv_b_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: { userId: driverUserB.id, employeeCode: `DRV-RTC-B-${Date.now()}`, displayName: 'Driver RTC B', phone: driverUserB.phone },
    });
    driverDeviceB = await prisma.device.create({
      data: { userId: driverUserB.id, deviceIdentifier: `drvb-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSessionB = await prisma.session.create({
      data: { userId: driverUserB.id, deviceId: driverDeviceB.id, refreshTokenHash: 'h_drvb', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverTokenB = jwt.sign(
      { sub: driverUserB.id, role: 'DRIVER', deviceId: driverDeviceB.id, sessionId: driverSessionB.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );
  });

  afterAll(async () => {
    await prisma.realtimeSession.deleteMany({ where: { ownerId: ownerUser.id } });
    if (driverUserA) {
      await prisma.driver.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.session.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.device.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.user.delete({ where: { id: driverUserA.id } });
    }
    if (driverUserB) {
      await prisma.driver.deleteMany({ where: { userId: driverUserB.id } });
      await prisma.session.deleteMany({ where: { userId: driverUserB.id } });
      await prisma.device.deleteMany({ where: { userId: driverUserB.id } });
      await prisma.user.delete({ where: { id: driverUserB.id } });
    }
    if (ownerUser) {
      await prisma.session.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.device.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.user.delete({ where: { id: ownerUser.id } });
    }
    await app.close();
  });

  it('should initiate PTT Voice Session and generate Ephemeral TURN Credentials (POST /v1/voice-sessions)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/voice-sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        driverId: driverEntityA.id,
        type: 'VOICE_PTT',
      })
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionId).toBeDefined();
    expect(res.body.data.type).toBe('VOICE_PTT');
    expect(res.body.data.status).toBe('PENDING');

    // Verify Ephemeral TURN Credentials
    expect(res.body.data.turnCredentials).toBeDefined();
    expect(res.body.data.turnCredentials.username).toContain(ownerUser.id);
    expect(res.body.data.turnCredentials.credential).toBeDefined();

    voiceSessionId = res.body.data.sessionId;
  });

  it('should initiate Video Session (POST /v1/video-sessions)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/video-sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        driverId: driverEntityA.id,
        type: 'VIDEO',
      })
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('VIDEO');

    videoSessionId = res.body.data.sessionId;
  });

  it('should REJECT Driver B attempting to respond to Driver A call session (403 IDOR Defense)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/realtime/sessions/${voiceSessionId}/respond`)
      .set('Authorization', `Bearer ${driverTokenB}`)
      .send({ action: 'ACCEPT' })
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('should allow Driver A to ACCEPT the voice session (POST /v1/realtime/sessions/:id/respond)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/realtime/sessions/${voiceSessionId}/respond`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send({ action: 'ACCEPT' })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.startedAt).toBeDefined();
  });

  it('should allow Driver A to DECLINE the video session', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/realtime/sessions/${videoSessionId}/respond`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send({ action: 'DECLINE' })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('DECLINED');
  });

  it('should allow Owner or Driver to END an active call session (POST /v1/realtime/sessions/:id/end)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/realtime/sessions/${voiceSessionId}/end`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ENDED');
    expect(res.body.data.endedAt).toBeDefined();
  });
});

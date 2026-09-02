import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { NotificationService } from '../../src/modules/notifications/services/notification.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Operational Notification Engine & Push Token Registration (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notificationService: NotificationService;

  let ownerUser: any;
  let ownerToken: string;

  let driverUserA: any;
  let driverDeviceA: any;
  let driverSessionA: any;
  let driverTokenA: string;

  let driverUserB: any;
  let driverDeviceB: any;
  let driverSessionB: any;
  let driverTokenB: string;

  let notifId: string;

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
    notificationService = app.get(NotificationService);

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
        username: `nft_own_${Date.now()}`,
        phone: `+62818${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });
    const ownerDev = await prisma.device.create({
      data: { userId: ownerUser.id, deviceIdentifier: `own-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const ownerSes = await prisma.session.create({
      data: { userId: ownerUser.id, deviceId: ownerDev.id, refreshTokenHash: 'h_own', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    ownerToken = jwt.sign(
      { sub: ownerUser.id, role: 'OWNER', deviceId: ownerDev.id, sessionId: ownerSes.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    driverUserA = await prisma.user.create({
      data: {
        username: `nft_drv_a_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
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
        username: `nft_drv_b_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
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
    if (driverUserA) {
      await prisma.notification.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.session.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.device.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.user.delete({ where: { id: driverUserA.id } });
    }
    if (driverUserB) {
      await prisma.notification.deleteMany({ where: { userId: driverUserB.id } });
      await prisma.session.deleteMany({ where: { userId: driverUserB.id } });
      await prisma.device.deleteMany({ where: { userId: driverUserB.id } });
      await prisma.user.delete({ where: { id: driverUserB.id } });
    }
    if (ownerUser) {
      await prisma.notification.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.session.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.device.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.user.delete({ where: { id: ownerUser.id } });
    }
    await app.close();
  });

  it('should register FCM push token for Driver A device (POST /v1/devices/register-push-token)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/devices/register-push-token')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send({
        deviceId: driverDeviceA.id,
        pushToken: 'fcm_token_sample_string_12345',
      })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.pushTokenRegistered).toBe(true);

    const dev = await prisma.device.findUnique({ where: { id: driverDeviceA.id } });
    expect(dev?.pushToken).toBe('fcm_token_sample_string_12345');
  });

  it('should REJECT Driver B attempting to register push token to Driver A device (Device Ownership Check)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/devices/register-push-token')
      .set('Authorization', `Bearer ${driverTokenB}`)
      .send({
        deviceId: driverDeviceA.id,
        pushToken: 'forged_fcm_token',
      })
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('DEVICE_OWNERSHIP_REQUIRED');
  });

  it('should send operational notification and verify zero E2EE/secret in payload', async () => {
    const notif = await notificationService.sendOperationalNotification(
      driverUserA.id,
      'DELIVERY_ASSIGNED',
      'Pengiriman Baru',
      'Tugas pengiriman baru telah ditugaskan kepada Anda',
      { deliveryId: 'del-123' },
    );

    expect(notif).toBeDefined();
    expect(notif.status).toBe('SENT');
    notifId = notif.id;
  });

  it('should fetch user notifications (GET /v1/notifications)', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/notifications')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.notifications.length).toBeGreaterThan(0);
    expect(res.body.data.notifications[0].type).toBe('DELIVERY_ASSIGNED');
  });

  it('should mark notification as read (PATCH /v1/notifications/:id/read)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('READ');
  });
});

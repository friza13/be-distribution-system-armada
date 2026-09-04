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

describe('REST Telemetry Ingestion API (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

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

  let ownerUser: any;
  let ownerToken: string;

  let deliveryA: any;
  let deliveryB: any;

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

    const driverRole = await prisma.role.upsert({
      where: { code: 'DRIVER' },
      update: {},
      create: { code: 'DRIVER', name: 'Driver' },
    });

    const ownerRole = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    // 1. Owner Setup
    ownerUser = await prisma.user.create({
      data: {
        username: `tr_own_${Date.now()}`,
        phone: `+62818${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    const ownerDevice = await prisma.device.create({
      data: { userId: ownerUser.id, deviceIdentifier: `own-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const ownerSession = await prisma.session.create({
      data: { userId: ownerUser.id, deviceId: ownerDevice.id, refreshTokenHash: 'h', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    ownerToken = jwt.sign(
      { sub: ownerUser.id, role: 'OWNER', deviceId: ownerDevice.id, sessionId: ownerSession.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // 2. Driver A Setup
    driverUserA = await prisma.user.create({
      data: {
        username: `tr_drv_a_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-A-${Date.now()}`, displayName: 'Driver A', phone: driverUserA.phone },
    });
    driverDeviceA = await prisma.device.create({
      data: { userId: driverUserA.id, deviceIdentifier: `drva-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSessionA = await prisma.session.create({
      data: { userId: driverUserA.id, deviceId: driverDeviceA.id, refreshTokenHash: 'h_a', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverTokenA = jwt.sign(
      { sub: driverUserA.id, role: 'DRIVER', deviceId: driverDeviceA.id, sessionId: driverSessionA.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // 3. Driver B Setup
    driverUserB = await prisma.user.create({
      data: {
        username: `tr_drv_b_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: { userId: driverUserB.id, employeeCode: `DRV-B-${Date.now()}`, displayName: 'Driver B', phone: driverUserB.phone },
    });
    driverDeviceB = await prisma.device.create({
      data: { userId: driverUserB.id, deviceIdentifier: `drvb-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSessionB = await prisma.session.create({
      data: { userId: driverUserB.id, deviceId: driverDeviceB.id, refreshTokenHash: 'h_b', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverTokenB = jwt.sign(
      { sub: driverUserB.id, role: 'DRIVER', deviceId: driverDeviceB.id, sessionId: driverSessionB.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // 4. Deliveries
    deliveryA = await prisma.delivery.create({
      data: { deliveryCode: `DEL-TR-A-${Date.now()}`, driverId: driverEntityA.id, createdBy: ownerUser.id, status: 'ASSIGNED' },
    });
    deliveryB = await prisma.delivery.create({
      data: { deliveryCode: `DEL-TR-B-${Date.now()}`, driverId: driverEntityB.id, createdBy: ownerUser.id, status: 'ASSIGNED' },
    });
  });

  afterAll(async () => {
    if (deliveryA) await prisma.delivery.deleteMany({ where: { id: deliveryA.id } });
    if (deliveryB) await prisma.delivery.deleteMany({ where: { id: deliveryB.id } });

    if (driverUserA) {
      await prisma.$executeRaw`DELETE FROM location_points WHERE driver_id = ${driverEntityA.id}::uuid`;
      await prisma.driver.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.session.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.device.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.user.delete({ where: { id: driverUserA.id } });
    }
    if (driverUserB) {
      await prisma.$executeRaw`DELETE FROM location_points WHERE driver_id = ${driverEntityB.id}::uuid`;
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

  beforeEach(async () => {
    // Clear rate limits before each test
    if (driverEntityA) await redis.resetRateLimit(`throttle:location:driver:${driverEntityA.id}`);
    if (driverEntityB) await redis.resetRateLimit(`throttle:location:driver:${driverEntityB.id}`);
    if (driverEntityA) await redis.resetRateLimit(`throttle:location:batch:driver:${driverEntityA.id}`);
  });

  it('should successfully ingest single GPS telemetry for Driver A with deliveryA', async () => {
    const payload = {
      latitude: -6.20012,
      longitude: 106.8162,
      accuracyM: 10.5,
      speedMps: 12.0,
      headingDeg: 180,
      recordedAt: new Date().toISOString(),
      deliveryId: deliveryA.id,
    };

    const res = await request(app.getHttpServer())
      .post('/v1/me/location')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('locationId');
    expect(res.body.data.validationStatus).toBe('VALID');

    // Verify PostGIS database persistence & trigger sync
    const points = await prisma.$queryRaw<any[]>`
      SELECT id, driver_id, delivery_id, latitude, longitude, validation_status
      FROM location_points WHERE id = ${res.body.data.locationId}::uuid
    `;
    expect(points.length).toBe(1);
    expect(points[0].driver_id).toBe(driverEntityA.id);
    expect(points[0].delivery_id).toBe(deliveryA.id);
  });

  it('should reject Driver A attempting to submit GPS for Delivery B (Delivery Ownership Guard)', async () => {
    const payload = {
      latitude: -6.20012,
      longitude: 106.8162,
      accuracyM: 10.5,
      recordedAt: new Date().toISOString(),
      deliveryId: deliveryB.id, // Assigned to Driver B
    };

    const res = await request(app.getHttpServer())
      .post('/v1/me/location')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('DELIVERY_NOT_ASSIGNED_TO_DRIVER');
  });

  it('should reject non-DRIVER role (Owner) from submitting telemetry', async () => {
    const payload = {
      latitude: -6.20012,
      longitude: 106.8162,
      accuracyM: 10.5,
      recordedAt: new Date().toISOString(),
    };

    const res = await request(app.getHttpServer())
      .post('/v1/me/location')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('should reject GPS payload with accuracy > 50m with 400 Bad Request via DTO pipe', async () => {
    const payload = {
      latitude: -6.20012,
      longitude: 106.8162,
      accuracyM: 75.0, // Exceeds 50m threshold
      recordedAt: new Date().toISOString(),
    };

    const res = await request(app.getHttpServer())
      .post('/v1/me/location')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should enforce 1 req/sec rate limit per driver', async () => {
    const payload = {
      latitude: -6.20012,
      longitude: 106.8162,
      accuracyM: 10.0,
      recordedAt: new Date().toISOString(),
    };

    // First request -> 201 Created
    await request(app.getHttpServer())
      .post('/v1/me/location')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.CREATED);

    // Second rapid request (<1s) -> 429 Too Many Requests
    const res = await request(app.getHttpServer())
      .post('/v1/me/location')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.TOO_MANY_REQUESTS);

    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should process idempotencyKey duplicate requests race-safely and return cached 200 OK', async () => {
    const idempotencyKey = uuidv4();
    const payload = {
      latitude: -6.20012,
      longitude: 106.8162,
      accuracyM: 10.0,
      recordedAt: new Date().toISOString(),
      idempotencyKey,
    };

    // 1. Initial request -> 201 Created
    const res1 = await request(app.getHttpServer())
      .post('/v1/me/location')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.CREATED);

    expect(res1.body.data.idempotent).toBeUndefined();

    // Clear rate limit to allow retry
    await redis.resetRateLimit(`throttle:location:driver:${driverEntityA.id}`);

    // 2. Duplicate request with same idempotencyKey -> 200 OK (Idempotent Cached Result)
    const res2 = await request(app.getHttpServer())
      .post('/v1/me/location')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.OK);

    expect(res2.body.data.idempotent).toBe(true);
    expect(res2.body.data.locationId).toBe(res1.body.data.locationId);
  });

  it('should process batch ingestion (POST /v1/me/location/batch) with 1 to 50 points', async () => {
    const batchPayload = {
      points: [
        {
          latitude: -6.2001,
          longitude: 106.8161,
          accuracyM: 10,
          recordedAt: new Date(Date.now() - 30000).toISOString(),
        },
        {
          latitude: -6.2002,
          longitude: 106.8162,
          accuracyM: 12,
          recordedAt: new Date(Date.now() - 10000).toISOString(),
        },
      ],
    };

    const res = await request(app.getHttpServer())
      .post('/v1/me/location/batch')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(batchPayload)
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accepted).toBe(2);
    expect(res.body.data.rejected).toBe(0);
    expect(res.body.data.latestBroadcast).toBeDefined();
    expect(res.body.data.latestBroadcast.latitude).toBe(-6.2002);
  });

  it('should reject batch exceeding 50 points with 400 Bad Request', async () => {
    const points51 = Array(51).fill({
      latitude: -6.2001,
      longitude: 106.8161,
      accuracyM: 10,
      recordedAt: new Date().toISOString(),
    });

    const res = await request(app.getHttpServer())
      .post('/v1/me/location/batch')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send({ points: points51 })
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body.error).toBeDefined();
  });
});

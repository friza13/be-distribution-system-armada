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

describe('Route Management & Optimization REST APIs (E2E)', () => {
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
  let stopA1: any;
  let stopA2: any;
  let stopA3: any;

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
        username: `rt_own_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        phone: `+62818${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });
    const ownerDev = await prisma.device.create({
      data: { userId: ownerUser.id, deviceIdentifier: `own-${Date.now()}-${Math.floor(Math.random() * 10000)}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const ownerSes = await prisma.session.create({
      data: { userId: ownerUser.id, deviceId: ownerDev.id, refreshTokenHash: 'h_own', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    ownerToken = jwt.sign(
      { sub: ownerUser.id, role: 'OWNER', deviceId: ownerDev.id, sessionId: ownerSes.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // 2. Driver A Setup
    driverUserA = await prisma.user.create({
      data: {
        username: `rt_drv_a_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        phone: `+62821${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-RT-A-${Date.now()}-${Math.floor(Math.random() * 10000)}`, displayName: 'Driver Route A', phone: driverUserA.phone },
    });
    driverDeviceA = await prisma.device.create({
      data: { userId: driverUserA.id, deviceIdentifier: `drva-${Date.now()}-${Math.floor(Math.random() * 10000)}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSessionA = await prisma.session.create({
      data: { userId: driverUserA.id, deviceId: driverDeviceA.id, refreshTokenHash: 'h_drva', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverTokenA = jwt.sign(
      { sub: driverUserA.id, role: 'DRIVER', deviceId: driverDeviceA.id, sessionId: driverSessionA.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // 3. Driver B Setup
    driverUserB = await prisma.user.create({
      data: {
        username: `rt_drv_b_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        phone: `+62822${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: { userId: driverUserB.id, employeeCode: `DRV-RT-B-${Date.now()}-${Math.floor(Math.random() * 10000)}`, displayName: 'Driver Route B', phone: driverUserB.phone },
    });
    driverDeviceB = await prisma.device.create({
      data: { userId: driverUserB.id, deviceIdentifier: `drvb-${Date.now()}-${Math.floor(Math.random() * 10000)}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSessionB = await prisma.session.create({
      data: { userId: driverUserB.id, deviceId: driverDeviceB.id, refreshTokenHash: 'h_drvb', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverTokenB = jwt.sign(
      { sub: driverUserB.id, role: 'DRIVER', deviceId: driverDeviceB.id, sessionId: driverSessionB.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // 4. Deliveries and DeliveryStops
    deliveryA = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-RTE-A-${Date.now()}`,
        driverId: driverEntityA.id,
        createdBy: ownerUser.id,
        status: 'ASSIGNED',
        routeMode: 'RECOMMENDED_2OPT',
      },
    });

    stopA1 = await prisma.deliveryStop.create({
      data: { deliveryId: deliveryA.id, sequence: 1, destinationName: 'Monas', address: 'Jakarta Pusat', latitude: -6.1754, longitude: 106.8272 },
    });

    stopA2 = await prisma.deliveryStop.create({
      data: { deliveryId: deliveryA.id, sequence: 2, destinationName: 'GBK', address: 'Jakarta Selatan', latitude: -6.2183, longitude: 106.8026 },
    });

    stopA3 = await prisma.deliveryStop.create({
      data: { deliveryId: deliveryA.id, sequence: 3, destinationName: 'Bunderan HI', address: 'Jakarta Pusat', latitude: -6.1950, longitude: 106.8230 },
    });

    deliveryB = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-RTE-B-${Date.now()}`,
        driverId: driverEntityB.id,
        createdBy: ownerUser.id,
        status: 'ASSIGNED',
        routeMode: 'RECOMMENDED_2OPT',
      },
    });
  });

  afterAll(async () => {
    if (deliveryA) {
      await prisma.routeStop.deleteMany({ where: { route: { deliveryId: deliveryA.id } } });
      await prisma.route.deleteMany({ where: { deliveryId: deliveryA.id } });
      await prisma.deliveryStop.deleteMany({ where: { deliveryId: deliveryA.id } });
      await prisma.delivery.delete({ where: { id: deliveryA.id } });
    }
    if (deliveryB) {
      await prisma.delivery.delete({ where: { id: deliveryB.id } });
    }
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

  beforeEach(async () => {
    if (deliveryA) await redis.resetRateLimit(`throttle:route:delivery:${deliveryA.id}`);
  });

  it('should recommend an optimal route sequence for Delivery A (POST /v1/deliveries/:id/routes/recommend)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryA.id}/routes/recommend?provider=haversine`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.deliveryId).toBe(deliveryA.id);
    expect(res.body.data.algorithm).toBe('EXHAUSTIVE_PERMUTATION');
    expect(res.body.data.recommendedSequence.length).toBe(3);
    // Bunderan HI (stopA3) is closer to Monas (stopA1) than GBK (stopA2), so stopA3 comes second
    expect(res.body.data.recommendedSequence[1].deliveryStopId).toBe(stopA3.id);
  });

  it('should select and activate route version 1 (POST /v1/deliveries/:id/routes/select)', async () => {
    const payload = {
      source: 'RECOMMENDED_2OPT',
      recommendedSequence: [stopA1.id, stopA3.id, stopA2.id],
      totalDistanceMeters: 5500,
      estimatedDurationSeconds: 660,
    };

    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryA.id}/routes/select`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.deliveryId).toBe(deliveryA.id);
  });

  it('should increment route version to 2 upon selecting a new route', async () => {
    const payload = {
      source: 'RECOMMENDED_2OPT',
      recommendedSequence: [stopA1.id, stopA2.id, stopA3.id],
      totalDistanceMeters: 6000,
      estimatedDurationSeconds: 700,
    };

    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryA.id}/routes/select`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe(2);
  });

  it('should manually reorder stop sequence and set routeMode = MANUAL (PATCH /v1/deliveries/:id/routes/reorder)', async () => {
    const payload = {
      stopSequence: [
        { deliveryStopId: stopA3.id, sequence: 1 },
        { deliveryStopId: stopA1.id, sequence: 2 },
        { deliveryStopId: stopA2.id, sequence: 3 },
      ],
    };

    const res = await request(app.getHttpServer())
      .patch(`/v1/deliveries/${deliveryA.id}/routes/reorder`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(payload)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe(3);
    expect(res.body.data.source).toBe('MANUAL');
  });

  it('should fetch the active current route (GET /v1/deliveries/:id/routes/current)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/deliveries/${deliveryA.id}/routes/current`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe(3);
    expect(res.body.data.source).toBe('MANUAL');
    expect(res.body.data.stops.length).toBe(3);
    expect(res.body.data.stops[0].deliveryStopId).toBe(stopA3.id);
  });

  it('should fetch all historical route versions (GET /v1/deliveries/:id/routes/versions)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/deliveries/${deliveryA.id}/routes/versions`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.versions.length).toBe(3);
    expect(res.body.data.versions[0].version).toBe(3);
  });

  it('should preserve historical route stops sequence immutability for past versions', async () => {
    // Query historical Route Version 1 from DB
    const routeV1 = await prisma.route.findFirst({
      where: { deliveryId: deliveryA.id, version: 1 },
      include: {
        routeStops: {
          orderBy: { sequence: 'asc' },
        },
      },
    });

    expect(routeV1).toBeDefined();
    expect(routeV1?.version).toBe(1);
    // Version 1 had sequence: stopA1 -> stopA3 -> stopA2
    expect(routeV1?.routeStops[0].deliveryStopId).toBe(stopA1.id);
    expect(routeV1?.routeStops[1].deliveryStopId).toBe(stopA3.id);
    expect(routeV1?.routeStops[2].deliveryStopId).toBe(stopA2.id);
  });

  it('should REJECT Driver B attempting to recommend or modify Delivery A route (Anti-IDOR protection)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryA.id}/routes/recommend`)
      .set('Authorization', `Bearer ${driverTokenB}`)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('should return 404 NOT_FOUND for non-existent deliveryId', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${uuidv4()}/routes/recommend`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.NOT_FOUND);

    expect(res.body.error.code).toBe('DELIVERY_NOT_FOUND');
  });
});

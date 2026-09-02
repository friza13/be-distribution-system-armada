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
import { TrackingCacheService } from '../../src/modules/tracking/services/tracking-cache.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Fleet Live Monitoring & Driver Location History APIs (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let trackingCacheService: TrackingCacheService;

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

  let adminUser: any;
  let adminToken: string;

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
    trackingCacheService = app.get(TrackingCacheService);

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

    const adminRole = await prisma.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', name: 'Admin' },
    });

    // 1. Owner & Admin Setup
    ownerUser = await prisma.user.create({
      data: {
        username: `fl_own_${Date.now()}`,
        phone: `+62818${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });
    const ownerDev = await prisma.device.create({ data: { userId: ownerUser.id, deviceIdentifier: `o-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' } });
    const ownerSes = await prisma.session.create({ data: { userId: ownerUser.id, deviceId: ownerDev.id, refreshTokenHash: 'h_own', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) } });
    ownerToken = jwt.sign({ sub: ownerUser.id, role: 'OWNER', deviceId: ownerDev.id, sessionId: ownerSes.id, type: 'ACCESS_TOKEN' }, secretKey, { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } });

    adminUser = await prisma.user.create({
      data: {
        username: `fl_adm_${Date.now()}`,
        phone: `+62819${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: adminRole.id,
        status: 'ACTIVE',
      },
    });
    const adminDev = await prisma.device.create({ data: { userId: adminUser.id, deviceIdentifier: `a-${Date.now()}`, platform: 'WEB', appVersion: '1.0.0' } });
    const adminSes = await prisma.session.create({ data: { userId: adminUser.id, deviceId: adminDev.id, refreshTokenHash: 'h_adm', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) } });
    adminToken = jwt.sign({ sub: adminUser.id, role: 'ADMIN', deviceId: adminDev.id, sessionId: adminSes.id, type: 'ACCESS_TOKEN' }, secretKey, { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } });

    // 2. Driver A Setup
    driverUserA = await prisma.user.create({
      data: {
        username: `fl_drv_a_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `EMP-FL-A-${Date.now()}`, displayName: 'Fleet Driver A', phone: driverUserA.phone, operationalStatus: 'AVAILABLE' },
    });
    driverDeviceA = await prisma.device.create({ data: { userId: driverUserA.id, deviceIdentifier: `da-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' } });
    driverSessionA = await prisma.session.create({ data: { userId: driverUserA.id, deviceId: driverDeviceA.id, refreshTokenHash: 'h_da', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) } });
    driverTokenA = jwt.sign({ sub: driverUserA.id, role: 'DRIVER', deviceId: driverDeviceA.id, sessionId: driverSessionA.id, type: 'ACCESS_TOKEN' }, secretKey, { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } });

    // 3. Driver B Setup
    driverUserB = await prisma.user.create({
      data: {
        username: `fl_drv_b_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: { userId: driverUserB.id, employeeCode: `EMP-FL-B-${Date.now()}`, displayName: 'Fleet Driver B', phone: driverUserB.phone, operationalStatus: 'ON_DELIVERY' },
    });
    driverDeviceB = await prisma.device.create({ data: { userId: driverUserB.id, deviceIdentifier: `db-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' } });
    driverSessionB = await prisma.session.create({ data: { userId: driverUserB.id, deviceId: driverDeviceB.id, refreshTokenHash: 'h_db', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) } });
    driverTokenB = jwt.sign({ sub: driverUserB.id, role: 'DRIVER', deviceId: driverDeviceB.id, sessionId: driverSessionB.id, type: 'ACCESS_TOKEN' }, secretKey, { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } });

    // Seed Redis cache and PostGIS history for Driver A
    await trackingCacheService.setLatestLocation(driverEntityA.id, {
      driverId: driverEntityA.id,
      latitude: -6.20012,
      longitude: 106.8162,
      accuracyM: 8.5,
      recordedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    });

    const recDate = new Date('2026-09-02T10:00:00.000Z');
    await prisma.$executeRaw`
      INSERT INTO location_points (id, driver_id, latitude, longitude, geom, accuracy_m, recorded_at, received_at, validation_status)
      VALUES (${uuidv4()}::uuid, ${driverEntityA.id}::uuid, -6.20012, 106.8162, ST_SetSRID(ST_MakePoint(106.8162, -6.20012), 4326), 8.5, ${recDate}, ${recDate}, 'VALID')
    `;
  });

  afterAll(async () => {
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
    if (adminUser) {
      await prisma.session.deleteMany({ where: { userId: adminUser.id } });
      await prisma.device.deleteMany({ where: { userId: adminUser.id } });
      await prisma.user.delete({ where: { id: adminUser.id } });
    }
    await app.close();
  });

  it('should allow Owner to fetch GET /v1/fleet/locations', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/fleet/locations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.drivers).toBeDefined();
    expect(Array.isArray(res.body.data.drivers)).toBe(true);

    const drvA = res.body.data.drivers.find((d: any) => d.driverId === driverEntityA.id);
    expect(drvA).toBeDefined();
    expect(drvA.location.latitude).toBe(-6.20012);
  });

  it('should allow Admin to fetch GET /v1/fleet/locations', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/fleet/locations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.drivers.length).toBeGreaterThan(0);
  });

  it('should REJECT Driver attempting to fetch GET /v1/fleet/locations with 403 Forbidden', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/fleet/locations')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('should ALLOW Driver A to fetch their OWN location history GET /v1/drivers/:id/location-history', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/drivers/${driverEntityA.id}/location-history?from=2026-09-01T00:00:00Z&to=2026-09-03T00:00:00Z`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.driverId).toBe(driverEntityA.id);
    expect(res.body.data.points.length).toBeGreaterThan(0);
  });

  it('should REJECT Driver A attempting to fetch Driver B location history (Anti-IDOR protection)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/drivers/${driverEntityB.id}/location-history?from=2026-09-01T00:00:00Z&to=2026-09-03T00:00:00Z`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('should reject invalid date range (from > to) with 400 Bad Request', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/drivers/${driverEntityA.id}/location-history?from=2026-09-05T00:00:00Z&to=2026-09-01T00:00:00Z`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('should return 404 DRIVER_NOT_FOUND when querying a non-existent driverId', async () => {
    const nonExistentId = uuidv4();
    const res = await request(app.getHttpServer())
      .get(`/v1/drivers/${nonExistentId}/location-history?from=2026-09-01T00:00:00Z`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.NOT_FOUND);

    expect(res.body.error.code).toBe('DRIVER_NOT_FOUND');
  });
});

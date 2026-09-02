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

describe('DeliveryStop Lifecycle & State Machine (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerUser: any;
  let ownerToken: string;

  let driverUserA: any;
  let driverEntityA: any;
  let driverTokenA: string;

  let driverUserB: any;
  let driverEntityB: any;
  let driverTokenB: string;

  let vehicleEntity: any;
  let createdDeliveryId: string;
  let stop1Id: string;
  let stop2Id: string;

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

    // Owner Setup
    ownerUser = await prisma.user.create({
      data: {
        username: `stp_own_${Date.now()}`,
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

    // Driver A Setup
    driverUserA = await prisma.user.create({
      data: {
        username: `stp_drv_a_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-STP-A-${Date.now()}`, displayName: 'Driver Stop A', phone: driverUserA.phone },
    });
    const driverDevA = await prisma.device.create({
      data: { userId: driverUserA.id, deviceIdentifier: `drva-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const driverSesA = await prisma.session.create({
      data: { userId: driverUserA.id, deviceId: driverDevA.id, refreshTokenHash: 'h_drva', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverTokenA = jwt.sign(
      { sub: driverUserA.id, role: 'DRIVER', deviceId: driverDevA.id, sessionId: driverSesA.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // Driver B Setup
    driverUserB = await prisma.user.create({
      data: {
        username: `stp_drv_b_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: { userId: driverUserB.id, employeeCode: `DRV-STP-B-${Date.now()}`, displayName: 'Driver Stop B', phone: driverUserB.phone },
    });
    const driverDevB = await prisma.device.create({
      data: { userId: driverUserB.id, deviceIdentifier: `drvb-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const driverSesB = await prisma.session.create({
      data: { userId: driverUserB.id, deviceId: driverDevB.id, refreshTokenHash: 'h_drvb', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverTokenB = jwt.sign(
      { sub: driverUserB.id, role: 'DRIVER', deviceId: driverDevB.id, sessionId: driverSesB.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    vehicleEntity = await prisma.vehicle.create({
      data: { plateNumber: `B ${Date.now().toString().slice(-4)} STP`, vehicleType: 'VAN', capacityWeightKg: 1000.0 },
    });

    // Create & Assign & Accept & Start Delivery A
    const delRes = await request(app.getHttpServer())
      .post('/v1/deliveries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        deliveryCode: `DEL-STP-${Date.now()}`,
        items: [{ itemCode: 'I-1', itemName: 'Box', quantity: 1, unit: 'BOX' }],
        stops: [
          { sequence: 1, destinationName: 'Stop 1', address: 'Addr 1', latitude: -6.1754, longitude: 106.8272 },
          { sequence: 2, destinationName: 'Stop 2', address: 'Addr 2', latitude: -6.2250, longitude: 106.8000 },
        ],
      })
      .expect(HttpStatus.CREATED);

    createdDeliveryId = delRes.body.data.id;

    await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/assign`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ driverId: driverEntityA.id, vehicleId: vehicleEntity.id });

    await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/accept`)
      .set('Authorization', `Bearer ${driverTokenA}`);

    await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/start`)
      .set('Authorization', `Bearer ${driverTokenA}`);

    const deliveryWithStops = await prisma.delivery.findUnique({
      where: { id: createdDeliveryId },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });

    stop1Id = deliveryWithStops!.stops[0].id;
    stop2Id = deliveryWithStops!.stops[1].id;
  });

  afterAll(async () => {
    if (createdDeliveryId) {
      await prisma.deliveryEvent.deleteMany({ where: { deliveryId: createdDeliveryId } });
      await prisma.deliveryStop.deleteMany({ where: { deliveryId: createdDeliveryId } });
      await prisma.deliveryItem.deleteMany({ where: { deliveryId: createdDeliveryId } });
      await prisma.delivery.deleteMany({ where: { id: createdDeliveryId } });
    }
    if (vehicleEntity) await prisma.vehicle.delete({ where: { id: vehicleEntity.id } });
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

  it('should allow Driver A to depart to stop 1 (POST /v1/me/stops/:id/depart)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop1Id}/depart`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('EN_ROUTE');
  });

  it('should REJECT Driver B attempting to depart to Driver A stop (Anti-IDOR protection)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop1Id}/arrive`)
      .set('Authorization', `Bearer ${driverTokenB}`)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('should allow Driver A to arrive at stop 1 (POST /v1/me/stops/:id/arrive)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop1Id}/arrive`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ARRIVED');
    expect(res.body.data.arrivedAt).toBeDefined();
  });

  it('should allow Driver A to start unloading at stop 1 (POST /v1/me/stops/:id/unload)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop1Id}/unload`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('UNLOADING');
  });

  it('should allow Driver A to fail stop 1 (POST /v1/me/stops/:id/fail)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop1Id}/fail`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send({ reason: 'Receiver not found' })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('FAILED');
  });

  it('should allow Driver A to skip stop 2 (POST /v1/me/stops/:id/skip)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop2Id}/skip`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send({ reason: 'Road block' })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('SKIPPED');
  });

  it('should REJECT illegal state transition on a finished stop with 409 Conflict', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop1Id}/arrive`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.CONFLICT);

    expect(['INVALID_STATE_TRANSITION', 'INVALID_DELIVERY_STATE']).toContain(res.body.error.code);
  });
});

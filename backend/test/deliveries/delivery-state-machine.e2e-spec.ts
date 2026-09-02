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

describe('Delivery Management & State Machine Engine (E2E)', () => {
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

    // 1. Owner Setup
    ownerUser = await prisma.user.create({
      data: {
        username: `del_own_${Date.now()}`,
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

    // 2. Driver A Setup
    driverUserA = await prisma.user.create({
      data: {
        username: `del_drv_a_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-DEL-A-${Date.now()}`, displayName: 'Driver Del A', phone: driverUserA.phone },
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

    // 3. Driver B Setup
    driverUserB = await prisma.user.create({
      data: {
        username: `del_drv_b_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: { userId: driverUserB.id, employeeCode: `DRV-DEL-B-${Date.now()}`, displayName: 'Driver Del B', phone: driverUserB.phone },
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

    // 4. Vehicle Setup
    vehicleEntity = await prisma.vehicle.create({
      data: {
        plateNumber: `B ${Date.now().toString().slice(-4)} DEL`,
        vehicleType: 'VAN',
        capacityWeightKg: 1000.0,
      },
    });
  });

  afterAll(async () => {
    if (createdDeliveryId) {
      await prisma.deliveryStop.deleteMany({ where: { deliveryId: createdDeliveryId } });
      await prisma.deliveryItem.deleteMany({ where: { deliveryId: createdDeliveryId } });
      await prisma.delivery.deleteMany({ where: { id: createdDeliveryId } });
    }
    if (vehicleEntity) {
      await prisma.vehicle.delete({ where: { id: vehicleEntity.id } });
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

  it('should create a new delivery in DRAFT status (POST /v1/deliveries)', async () => {
    const payload = {
      deliveryCode: `DEL-CODE-${Date.now()}`,
      items: [{ itemCode: 'ITM-1', itemName: 'Paket Elektronik', quantity: 2, unit: 'BOX' }],
      stops: [
        { sequence: 1, destinationName: 'Gudang Monas', address: 'Jakarta Pusat', latitude: -6.1754, longitude: 106.8272 },
        { sequence: 2, destinationName: 'Toko Senayan', address: 'Jakarta Selatan', latitude: -6.2250, longitude: 106.8000 },
      ],
    };

    const res = await request(app.getHttpServer())
      .post('/v1/deliveries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload)
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.deliveryCode).toBe(payload.deliveryCode);

    createdDeliveryId = res.body.data.id;
  });

  it('should assign Driver A and Vehicle to the delivery (POST /v1/deliveries/:id/assign)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/assign`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        driverId: driverEntityA.id,
        vehicleId: vehicleEntity.id,
      })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ASSIGNED');
    expect(res.body.data.driverId).toBe(driverEntityA.id);
  });

  it('should REJECT Driver B attempting to accept Driver A delivery (Anti-IDOR protection)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/accept`)
      .set('Authorization', `Bearer ${driverTokenB}`)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('should allow assigned Driver A to ACCEPT the delivery (POST /v1/deliveries/:id/accept)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/accept`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ACCEPTED');
  });

  it('should allow assigned Driver A to START the delivery trip (POST /v1/deliveries/:id/start)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/start`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('EN_ROUTE');
    expect(res.body.data.startedAt).toBeDefined();
  });

  it('should REJECT completion (POST /v1/deliveries/:id/complete) if stops remain unfinished', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/complete`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.CONFLICT);

    expect(res.body.error.code).toBe('UNFINISHED_STOPS_REMAIN');
  });

  it('should allow Owner to cancel an active delivery (POST /v1/deliveries/:id/cancel)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Operational cancellation by Owner' })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('should REJECT modifying a CANCELLED delivery status with 409 Conflict', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/accept`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.CONFLICT);

    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

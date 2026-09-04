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

describe('Route Terminal Delivery Guard (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let driverUser: any;
  let driverEntity: any;
  let driverDevice: any;
  let driverSession: any;
  let driverToken: string;

  let ownerUser: any;
  let ownerToken: string;

  let cancelledDelivery: any;
  let completedDelivery: any;
  let stopCancelled1: any;
  let stopCancelled2: any;
  let stopCompleted1: any;
  let stopCompleted2: any;

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

    ownerUser = await prisma.user.create({
      data: {
        username: `rt_term_own_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        phone: `+62818${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });
    const ownerDev = await prisma.device.create({
      data: { userId: ownerUser.id, deviceIdentifier: `term-own-${Date.now()}-${Math.floor(Math.random() * 10000)}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const ownerSes = await prisma.session.create({
      data: { userId: ownerUser.id, deviceId: ownerDev.id, refreshTokenHash: 'h_own', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    ownerToken = jwt.sign(
      { sub: ownerUser.id, role: 'OWNER', deviceId: ownerDev.id, sessionId: ownerSes.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    driverUser = await prisma.user.create({
      data: {
        username: `rt_term_drv_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        phone: `+62821${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverDevice = await prisma.device.create({
      data: { userId: driverUser.id, deviceIdentifier: `term-dev-${Date.now()}-${Math.floor(Math.random() * 10000)}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSession = await prisma.session.create({
      data: { userId: driverUser.id, deviceId: driverDevice.id, refreshTokenHash: 'h_drv', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverEntity = await prisma.driver.create({
      data: {
        userId: driverUser.id,
        employeeCode: `EMP-TERM-${Date.now()}`,
        displayName: 'Terminal Driver',
        phone: driverUser.phone,
        operationalStatus: 'AVAILABLE',
      },
    });
    driverToken = jwt.sign(
      { sub: driverUser.id, role: 'DRIVER', deviceId: driverDevice.id, sessionId: driverSession.id, driverId: driverEntity.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    cancelledDelivery = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-CANCELLED-${Date.now()}`,
        driverId: driverEntity.id,
        status: 'CANCELLED',
        createdBy: ownerUser.id,
      },
    });

    stopCancelled1 = await prisma.deliveryStop.create({
      data: {
        deliveryId: cancelledDelivery.id,
        sequence: 1,
        destinationName: 'Stop 1',
        address: 'Addr 1',
        latitude: -6.2001,
        longitude: 106.8162,
        status: 'PENDING',
      },
    });

    stopCancelled2 = await prisma.deliveryStop.create({
      data: {
        deliveryId: cancelledDelivery.id,
        sequence: 2,
        destinationName: 'Stop 2',
        address: 'Addr 2',
        latitude: -6.2101,
        longitude: 106.8262,
        status: 'PENDING',
      },
    });

    completedDelivery = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-COMPLETED-${Date.now()}`,
        driverId: driverEntity.id,
        status: 'COMPLETED',
        createdBy: ownerUser.id,
      },
    });

    stopCompleted1 = await prisma.deliveryStop.create({
      data: {
        deliveryId: completedDelivery.id,
        sequence: 1,
        destinationName: 'Stop C1',
        address: 'Addr C1',
        latitude: -6.2001,
        longitude: 106.8162,
        status: 'DELIVERED',
      },
    });

    stopCompleted2 = await prisma.deliveryStop.create({
      data: {
        deliveryId: completedDelivery.id,
        sequence: 2,
        destinationName: 'Stop C2',
        address: 'Addr C2',
        latitude: -6.2101,
        longitude: 106.8262,
        status: 'DELIVERED',
      },
    });
  });

  afterAll(async () => {
    if (cancelledDelivery) {
      await prisma.deliveryStop.deleteMany({ where: { deliveryId: cancelledDelivery.id } });
      await prisma.delivery.deleteMany({ where: { id: cancelledDelivery.id } });
    }
    if (completedDelivery) {
      await prisma.deliveryStop.deleteMany({ where: { deliveryId: completedDelivery.id } });
      await prisma.delivery.deleteMany({ where: { id: completedDelivery.id } });
    }
    if (driverUser) {
      await prisma.driver.deleteMany({ where: { userId: driverUser.id } });
      await prisma.session.deleteMany({ where: { userId: driverUser.id } });
      await prisma.device.deleteMany({ where: { userId: driverUser.id } });
      await prisma.user.deleteMany({ where: { id: driverUser.id } });
    }
    if (ownerUser) {
      await prisma.session.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.device.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.user.deleteMany({ where: { id: ownerUser.id } });
    }
    await app.close();
  });

  it('should reject route recommendation on CANCELLED delivery with 409 Conflict', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${cancelledDelivery.id}/routes/recommend`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ originLatitude: -6.1800, originLongitude: 106.8000 })
      .expect(HttpStatus.CONFLICT);

    expect(res.body.error.code).toBe('INVALID_DELIVERY_STATE');
  });

  it('should reject route selection on CANCELLED delivery with 409 Conflict', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${cancelledDelivery.id}/routes/select`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        source: 'RECOMMENDED_2OPT',
        recommendedSequence: [stopCancelled2.id, stopCancelled1.id],
        totalDistanceMeters: 5000,
        estimatedDurationSeconds: 600,
      })
      .expect(HttpStatus.CONFLICT);

    expect(res.body.error.code).toBe('INVALID_DELIVERY_STATE');
  });

  it('should reject stop reordering on COMPLETED delivery with 409 Conflict', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/deliveries/${completedDelivery.id}/routes/reorder`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        stopSequence: [
          { deliveryStopId: stopCompleted2.id, sequence: 1 },
          { deliveryStopId: stopCompleted1.id, sequence: 2 },
        ],
      })
      .expect(HttpStatus.CONFLICT);

    expect(res.body.error.code).toBe('INVALID_DELIVERY_STATE');
  });
});

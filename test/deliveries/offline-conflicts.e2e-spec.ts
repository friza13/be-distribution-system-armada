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

describe('Offline Outbox Sync & Deterministic Conflict Engine (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerUser: any;
  let ownerToken: string;

  let driverUserA: any;
  let driverEntityA: any;
  let driverTokenA: string;

  let vehicleEntity: any;
  let createdDeliveryId: string;
  let stop1Id: string;
  let conflictId: string;

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
        username: `cnf_own_${Date.now()}`,
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
        username: `cnf_drv_a_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-CNF-A-${Date.now()}`, displayName: 'Driver Conflict A', phone: driverUserA.phone },
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

    vehicleEntity = await prisma.vehicle.create({
      data: { plateNumber: `B ${Date.now().toString().slice(-4)} CNF`, vehicleType: 'VAN', capacityWeightKg: 1000.0 },
    });

    // Create & Assign & Accept Delivery
    const delRes = await request(app.getHttpServer())
      .post('/v1/deliveries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        deliveryCode: `DEL-CNF-${Date.now()}`,
        items: [{ itemCode: 'I-1', itemName: 'Box', quantity: 1, unit: 'BOX' }],
        stops: [{ sequence: 1, destinationName: 'Stop Monas', address: 'Addr Monas', latitude: -6.1754, longitude: 106.8272 }],
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

    const delWithStops = await prisma.delivery.findUnique({
      where: { id: createdDeliveryId },
      include: { stops: true },
    });
    stop1Id = delWithStops!.stops[0].id;

    // SIMULATE OFFLINE CONFLICT SCENARIO:
    // Owner cancels delivery on server while driver is offline
    await request(app.getHttpServer())
      .post(`/v1/deliveries/${createdDeliveryId}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Owner cancelled while driver was offline' })
      .expect(HttpStatus.OK);
  });

  afterAll(async () => {
    if (createdDeliveryId) {
      await prisma.proofOfDelivery.deleteMany({ where: { deliveryStopId: stop1Id } });
      await prisma.deliveryConflict.deleteMany({ where: { deliveryId: createdDeliveryId } });
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
    if (ownerUser) {
      await prisma.session.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.device.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.user.delete({ where: { id: ownerUser.id } });
    }
    await app.close();
  });

  it('should preserve evidence and create a DeliveryConflict ticket when driver syncs offline events for CANCELLED delivery', async () => {
    const outboxPayload = {
      events: [
        {
          clientEventId: 'client-evt-offline-1',
          eventType: 'stop.pod',
          occurredAt: new Date().toISOString(),
          payload: {
            deliveryStopId: stop1Id,
            receiverName: 'Offline Receiver',
            notes: 'Completed offline by driver',
          },
        },
      ],
    };

    const res = await request(app.getHttpServer())
      .post('/v1/me/sync/outbox')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send(outboxPayload)
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.conflicts.length).toBe(1);
    expect(res.body.data.conflicts[0].type).toBe('STALE_OFFLINE_COMPLETION');

    conflictId = res.body.data.conflicts[0].conflictId;
  });

  it('should allow Owner/Admin to fetch open delivery conflicts (GET /v1/conflicts)', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/conflicts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.conflicts.length).toBeGreaterThan(0);

    const found = res.body.data.conflicts.find((c: any) => c.conflictId === conflictId);
    expect(found).toBeDefined();
    expect(found.serverState).toBe('CANCELLED');
  });

  it('should allow Owner/Admin to resolve conflict with RESOLVED_OVERRIDDEN (POST /v1/conflicts/:id/resolve)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/conflicts/${conflictId}/resolve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        status: 'RESOLVED_OVERRIDDEN',
        resolutionNotes: 'Verified POD photo manually, accepting driver offline delivery',
      })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('RESOLVED_OVERRIDDEN');

    // Verify stop status updated to DELIVERED
    const stop = await prisma.deliveryStop.findUnique({ where: { id: stop1Id } });
    expect(stop?.status).toBe('DELIVERED');

    // Verify delivery status updated to COMPLETED
    const delivery = await prisma.delivery.findUnique({ where: { id: createdDeliveryId } });
    expect(delivery?.status).toBe('COMPLETED');
  });
});

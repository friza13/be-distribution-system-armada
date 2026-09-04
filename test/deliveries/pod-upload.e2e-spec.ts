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

describe('Secure File Upload & Proof of Delivery (POD) Service (E2E)', () => {
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
  let uploadedFileId: string;

  const secretKey = 'test_secret_with_minimum_32_characters_length_here';
  const issuer = 'dms-api';
  const audience = 'dms-clients';

  // Valid 2x2 JPEG buffer with complete SOF, dimensions, and magic bytes
  const validJpegBuffer = Buffer.from([
    255, 216, 255, 219, 0, 67, 0, 6, 4, 5, 6, 5, 4, 6, 6, 5, 6, 7, 7, 6, 8, 10, 16, 10, 10, 9, 9,
    10, 20, 14, 15, 12, 16, 23, 20, 24, 24, 23, 20, 22, 22, 26, 29, 37, 31, 26, 27, 35, 28, 22,
    22, 32, 44, 32, 35, 38, 39, 41, 42, 41, 25, 31, 45, 48, 45, 40, 48, 37, 40, 41, 40, 255, 219,
    0, 67, 1, 7, 7, 7, 10, 8, 10, 19, 10, 10, 19, 40, 26, 22, 26, 40, 40, 40, 40, 40, 40, 40, 40,
    40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40,
    40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40,
    40, 40, 255, 192, 0, 17, 8, 0, 2, 0, 2, 3, 1, 34, 0, 2, 17, 1, 3, 17, 1, 255, 196, 0, 21, 0,
    1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 255, 196, 0, 20, 16, 1, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 196, 0, 21, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 6, 8, 255, 196, 0, 20, 17, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 218,
    0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 157, 0, 28, 164, 95, 255, 217,
  ]);

  // Fake file buffer (invalid magic bytes)
  const invalidBuffer = Buffer.from('this is fake text content not an image');

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
        username: `pod_own_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
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

    // Driver A Setup
    driverUserA = await prisma.user.create({
      data: {
        username: `pod_drv_a_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        phone: `+62821${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-POD-A-${Date.now()}-${Math.floor(Math.random() * 10000)}`, displayName: 'Driver POD A', phone: driverUserA.phone },
    });
    const driverDevA = await prisma.device.create({
      data: { userId: driverUserA.id, deviceIdentifier: `drva-${Date.now()}-${Math.floor(Math.random() * 10000)}`, platform: 'ANDROID', appVersion: '1.0.0' },
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
        username: `pod_drv_b_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        phone: `+62822${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: { userId: driverUserB.id, employeeCode: `DRV-POD-B-${Date.now()}`, displayName: 'Driver POD B', phone: driverUserB.phone },
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
      data: { plateNumber: `B ${Date.now().toString().slice(-4)} POD`, vehicleType: 'VAN', capacityWeightKg: 1000.0 },
    });

    // Create & Assign & Accept & Start Delivery A with 1 stop
    const delRes = await request(app.getHttpServer())
      .post('/v1/deliveries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        deliveryCode: `DEL-POD-${Date.now()}`,
        items: [{ itemCode: 'I-1', itemName: 'Box', quantity: 1, unit: 'BOX' }],
        stops: [
          { sequence: 1, destinationName: 'Stop Monas', address: 'Addr Monas', latitude: -6.1754, longitude: 106.8272 },
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

    // Arrive & Unload stop 1
    await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop1Id}/arrive`)
      .set('Authorization', `Bearer ${driverTokenA}`);

    await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop1Id}/unload`)
      .set('Authorization', `Bearer ${driverTokenA}`);
  });

  afterAll(async () => {
    if (createdDeliveryId) {
      await prisma.proofOfDelivery.deleteMany({ where: { deliveryStopId: stop1Id } });
      if (uploadedFileId) await prisma.fileRecord.deleteMany({ where: { id: uploadedFileId } });
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

  it('should REJECT file upload with invalid magic bytes (422 Unprocessable Entity)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/files/upload')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .attach('file', invalidBuffer, { filename: 'test.jpg', contentType: 'image/jpeg' })
      .expect(HttpStatus.UNPROCESSABLE_ENTITY);

    expect(res.body.error.code).toBe('INVALID_FILE_MAGIC_BYTES');
  });

  it('should successfully upload valid JPEG file with magic bytes check (POST /v1/files/upload)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/files/upload')
      .set('Authorization', `Bearer ${driverTokenA}`)
      .attach('file', validJpegBuffer, { filename: 'pod_photo.jpg', contentType: 'image/jpeg' })
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.fileId).toBeDefined();
    expect(res.body.data.mediaType).toBe('image/jpeg');

    uploadedFileId = res.body.data.fileId;
  });

  it('should submit POD metadata for stop 1 (POST /v1/me/stops/:id/pod) and auto-complete delivery', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/stops/${stop1Id}/pod`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send({
        receiverName: 'Budi Santoso',
        photoFileId: uploadedFileId,
        notes: 'Diterima dalam kondisi baik',
      })
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('DELIVERED');

    // Verify stop 1 is DELIVERED
    const stop = await prisma.deliveryStop.findUnique({ where: { id: stop1Id } });
    expect(stop?.status).toBe('DELIVERED');

    // Verify Delivery A status automatically transitioned to COMPLETED
    const delivery = await prisma.delivery.findUnique({ where: { id: createdDeliveryId } });
    expect(delivery?.status).toBe('COMPLETED');
  });

  it('should support POD submission directly from ARRIVED state (shortcut transition without explicit UNLOADING)', async () => {
    // Create new delivery with 1 stop
    const delRes = await request(app.getHttpServer())
      .post('/v1/deliveries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        deliveryCode: `DEL-POD-SHORTCUT-${Date.now()}`,
        items: [{ itemCode: 'I-1', itemName: 'Box', quantity: 1, unit: 'BOX' }],
        stops: [{ sequence: 1, destinationName: 'Stop Monas Shortcut', address: 'Addr Monas', latitude: -6.1754, longitude: 106.8272 }],
      })
      .expect(HttpStatus.CREATED);

    const delId = delRes.body.data.id;
    await request(app.getHttpServer()).post(`/v1/deliveries/${delId}/assign`).set('Authorization', `Bearer ${ownerToken}`).send({ driverId: driverEntityA.id, vehicleId: vehicleEntity.id });
    await request(app.getHttpServer()).post(`/v1/deliveries/${delId}/accept`).set('Authorization', `Bearer ${driverTokenA}`);
    await request(app.getHttpServer()).post(`/v1/deliveries/${delId}/start`).set('Authorization', `Bearer ${driverTokenA}`);

    const delWithStops = await prisma.delivery.findUnique({ where: { id: delId }, include: { stops: true } });
    const sId = delWithStops!.stops[0].id;

    // Arrive at stop (status = ARRIVED)
    await request(app.getHttpServer()).post(`/v1/me/stops/${sId}/arrive`).set('Authorization', `Bearer ${driverTokenA}`);

    // Submit POD directly from ARRIVED state (bypassing explicit UNLOADING call)
    const podRes = await request(app.getHttpServer())
      .post(`/v1/me/stops/${sId}/pod`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send({
        receiverName: 'Shortcut Receiver',
        photoFileId: uploadedFileId,
      })
      .expect(HttpStatus.CREATED);

    expect(podRes.body.success).toBe(true);
    expect(podRes.body.data.status).toBe('DELIVERED');

    // Cleanup
    await prisma.proofOfDelivery.deleteMany({ where: { deliveryStopId: sId } });
    await prisma.deliveryEvent.deleteMany({ where: { deliveryId: delId } });
    await prisma.deliveryStop.deleteMany({ where: { deliveryId: delId } });
    await prisma.deliveryItem.deleteMany({ where: { deliveryId: delId } });
    await prisma.delivery.delete({ where: { id: delId } });
  });

  it('should allow Owner to download the POD photo file (GET /v1/files/:id/download)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/files/${uploadedFileId}/download`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(HttpStatus.OK);

    expect(res.header['content-type']).toBe('image/jpeg');
    expect(res.body).toBeDefined();
  });

  it('should REJECT Driver B attempting to download Driver A POD file (403 IDOR Defense)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/files/${uploadedFileId}/download`)
      .set('Authorization', `Bearer ${driverTokenB}`)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('should fetch POD details for delivery (GET /v1/deliveries/:id/pod)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/deliveries/${createdDeliveryId}/pod`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.pods.length).toBe(1);
    expect(res.body.data.pods[0].receiverName).toBe('Budi Santoso');
  });
});

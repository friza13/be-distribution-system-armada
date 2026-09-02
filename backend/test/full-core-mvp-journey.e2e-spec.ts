import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { hashPassword } from '../src/common/utils/password.util';

describe('Full Core MVP Journey Integration Test (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  let ownerUser: any;
  let ownerDevice: any;
  let ownerSession: any;
  let ownerToken: string;

  let driverUser: any;
  let driverEntity: any;
  let driverDevice: any;
  let driverSession: any;
  let driverToken: string;

  let vehicleEntity: any;
  let deliveryId: string;
  let stopId: string;
  let uploadedFileId: string;

  const secretKey = 'test_secret_with_minimum_32_characters_length_here';
  const issuer = 'dms-api';
  const audience = 'dms-clients';

  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xff, 0xd9,
  ]);

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

    // 1. Provision Owner
    ownerUser = await prisma.user.create({
      data: {
        username: `mvp_own_${Date.now()}`,
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

    // 2. Provision Driver
    driverUser = await prisma.user.create({
      data: {
        username: `mvp_drv_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntity = await prisma.driver.create({
      data: { userId: driverUser.id, employeeCode: `DRV-MVP-${Date.now()}`, displayName: 'MVP Journey Driver', phone: driverUser.phone, operationalStatus: 'AVAILABLE' },
    });
    driverDevice = await prisma.device.create({
      data: { userId: driverUser.id, deviceIdentifier: `drv-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSession = await prisma.session.create({
      data: { userId: driverUser.id, deviceId: driverDevice.id, refreshTokenHash: 'h_drv', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverToken = jwt.sign(
      { sub: driverUser.id, role: 'DRIVER', deviceId: driverDevice.id, sessionId: driverSession.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // 3. Provision Vehicle
    vehicleEntity = await prisma.vehicle.create({
      data: { plateNumber: `B ${Date.now().toString().slice(-4)} MVP`, vehicleType: 'VAN', capacityWeightKg: 1000.0 },
    });
  });

  afterAll(async () => {
    if (deliveryId) {
      await prisma.proofOfDelivery.deleteMany({ where: { deliveryStopId: stopId } });
      if (uploadedFileId) await prisma.fileRecord.deleteMany({ where: { id: uploadedFileId } });
      await prisma.routeStop.deleteMany({ where: { route: { deliveryId } } });
      await prisma.route.deleteMany({ where: { deliveryId } });
      await prisma.deliveryEvent.deleteMany({ where: { deliveryId } });
      await prisma.deliveryStop.deleteMany({ where: { deliveryId } });
      await prisma.deliveryItem.deleteMany({ where: { deliveryId } });
      await prisma.delivery.deleteMany({ where: { id: deliveryId } });
    }
    if (vehicleEntity) await prisma.vehicle.delete({ where: { id: vehicleEntity.id } });
    if (driverUser) {
      await prisma.$executeRaw`DELETE FROM location_points WHERE driver_id = ${driverEntity.id}::uuid`;
      await prisma.notification.deleteMany({ where: { userId: driverUser.id } });
      await prisma.driver.deleteMany({ where: { userId: driverUser.id } });
      await prisma.session.deleteMany({ where: { userId: driverUser.id } });
      await prisma.device.deleteMany({ where: { userId: driverUser.id } });
      await prisma.user.delete({ where: { id: driverUser.id } });
    }
    if (ownerUser) {
      await prisma.notification.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.session.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.device.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.user.delete({ where: { id: ownerUser.id } });
    }
    await app.close();
  });

  it('1. Driver registers push token for device (POST /v1/devices/register-push-token)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/devices/register-push-token')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ deviceId: driverDevice.id, pushToken: 'fcm_token_mvp_journey_sample' })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
  });

  it('2. Owner creates delivery order in DRAFT status (POST /v1/deliveries)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/deliveries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        deliveryCode: `DEL-MVP-${Date.now()}`,
        items: [{ itemCode: 'I-MVP', itemName: 'Kardus Paket', quantity: 5, unit: 'BOX' }],
        stops: [{ sequence: 1, destinationName: 'Gudang Monas MVP', address: 'Jakarta Pusat', latitude: -6.1754, longitude: 106.8272 }],
      })
      .expect(HttpStatus.CREATED);

    expect(res.body.data.status).toBe('DRAFT');
    deliveryId = res.body.data.id;
  });

  it('3. Owner requests route recommendation (POST /v1/deliveries/:id/routes/recommend)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/routes/recommend`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(HttpStatus.OK);

    expect(res.body.data.recommendedSequence.length).toBe(1);
    stopId = res.body.data.recommendedSequence[0].deliveryStopId;
  });

  it('4. Owner selects route version 1 and assigns Driver & Vehicle (POST /select & /assign)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/routes/select`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ source: 'RECOMMENDED_2OPT', recommendedSequence: [stopId], totalDistanceMeters: 1000, estimatedDurationSeconds: 120 })
      .expect(HttpStatus.CREATED);

    const assignRes = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/assign`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ driverId: driverEntity.id, vehicleId: vehicleEntity.id })
      .expect(HttpStatus.OK);

    expect(assignRes.body.data.status).toBe('ASSIGNED');
  });

  it('5. Driver accepts delivery & starts trip (POST /accept & /start)', async () => {
    await request(app.getHttpServer()).post(`/v1/deliveries/${deliveryId}/accept`).set('Authorization', `Bearer ${driverToken}`).expect(HttpStatus.OK);

    const startRes = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/start`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(HttpStatus.OK);

    expect(startRes.body.data.status).toBe('EN_ROUTE');
  });

  it('6. Driver submits GPS telemetry and Owner views live fleet map (POST /v1/me/location & GET /v1/fleet/locations)', async () => {
    // Ingest GPS
    await request(app.getHttpServer())
      .post('/v1/me/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ latitude: -6.1754, longitude: 106.8272, accuracyM: 10, recordedAt: new Date().toISOString(), deliveryId })
      .expect(HttpStatus.CREATED);

    // Fleet Map lookup
    const fleetRes = await request(app.getHttpServer())
      .get('/v1/fleet/locations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(HttpStatus.OK);

    expect(fleetRes.body.data.drivers.length).toBeGreaterThan(0);
  });

  it('7. Driver uploads POD photo, submits POD metadata, and Delivery auto-completes', async () => {
    // Upload POD photo
    const uploadRes = await request(app.getHttpServer())
      .post('/v1/files/upload')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', validJpegBuffer, { filename: 'pod_mvp.jpg', contentType: 'image/jpeg' })
      .expect(HttpStatus.CREATED);

    uploadedFileId = uploadRes.body.data.fileId;

    // Depart -> Arrive -> Unload
    await request(app.getHttpServer()).post(`/v1/me/stops/${stopId}/arrive`).set('Authorization', `Bearer ${driverToken}`).expect(HttpStatus.OK);
    await request(app.getHttpServer()).post(`/v1/me/stops/${stopId}/unload`).set('Authorization', `Bearer ${driverToken}`).expect(HttpStatus.OK);

    // Submit POD
    const podRes = await request(app.getHttpServer())
      .post(`/v1/me/stops/${stopId}/pod`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ receiverName: 'Penerima MVP', photoFileId: uploadedFileId })
      .expect(HttpStatus.CREATED);

    expect(podRes.body.data.status).toBe('DELIVERED');

    // Verify Delivery status COMPLETED
    const del = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    expect(del?.status).toBe('COMPLETED');
  });
});

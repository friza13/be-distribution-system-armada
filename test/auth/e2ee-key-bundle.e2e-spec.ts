import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('E2EE Device Key Registration & Prekey Infrastructure (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userA: any;
  let userB: any;
  let deviceA: any;
  let deviceB: any;
  let tokenA: string;
  let tokenB: string;

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

    userA = await prisma.user.create({
      data: {
        username: `e2ee_a_${Date.now()}`,
        phone: `+62827${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('PassA123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    userB = await prisma.user.create({
      data: {
        username: `e2ee_b_${Date.now()}`,
        phone: `+62828${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('PassB123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    deviceA = await prisma.device.create({
      data: {
        userId: userA.id,
        deviceIdentifier: `android-a-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
      },
    });

    deviceB = await prisma.device.create({
      data: {
        userId: userB.id,
        deviceIdentifier: `android-b-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
      },
    });

    const loginA = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: userA.username, password: 'PassA123!', deviceId: deviceA.id });
    tokenA = loginA.body.data.accessToken;

    const loginB = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: userB.username, password: 'PassB123!', deviceId: deviceB.id });
    tokenB = loginB.body.data.accessToken;
  });

  afterAll(async () => {
    if (deviceA) {
      await prisma.prekey.deleteMany({ where: { deviceId: deviceA.id } });
      await prisma.deviceKey.deleteMany({ where: { deviceId: deviceA.id } });
    }
    if (deviceB) {
      await prisma.prekey.deleteMany({ where: { deviceId: deviceB.id } });
      await prisma.deviceKey.deleteMany({ where: { deviceId: deviceB.id } });
    }
    if (userA) {
      await prisma.session.deleteMany({ where: { userId: userA.id } });
      await prisma.device.deleteMany({ where: { userId: userA.id } });
      await prisma.user.delete({ where: { id: userA.id } });
    }
    if (userB) {
      await prisma.session.deleteMany({ where: { userId: userB.id } });
      await prisma.device.deleteMany({ where: { userId: userB.id } });
      await prisma.user.delete({ where: { id: userB.id } });
    }
    await app.close();
  });

  it('should register device public keys and upload 25 prekeys for device A', async () => {
    // 1. Register Device Keys
    const regRes = await request(app.getHttpServer())
      .post('/v1/e2ee/keys/register')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        deviceId: deviceA.id,
        identityKeyPublic: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAidentityA',
        signedPrekeyPublic: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsignedA',
        signedPrekeySig: 'sig_data_signature_hex_or_base64_string_here_for_device_a',
      })
      .expect(HttpStatus.CREATED);

    expect(regRes.body.success).toBe(true);
    expect(regRes.body.data.deviceId).toBe(deviceA.id);

    // 2. Upload Batch 25 Prekeys
    const prekeys = Array.from({ length: 25 }, (_, i) => ({
      keyId: i + 1,
      publicKey: `prekey_public_${i + 1}_for_device_a`,
    }));

    const uploadRes = await request(app.getHttpServer())
      .post('/v1/e2ee/keys/prekeys')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        deviceId: deviceA.id,
        prekeys,
      })
      .expect(HttpStatus.CREATED);

    expect(uploadRes.body.success).toBe(true);
    expect(uploadRes.body.data.uploadedCount).toBe(25);
    expect(uploadRes.body.data.totalAvailable).toBe(25);
  });

  it('should reject User B attempting to upload prekeys to User A device (Device Ownership Check)', async () => {
    const prekeys = [{ keyId: 999, publicKey: 'unauthorized_prekey' }];

    const res = await request(app.getHttpServer())
      .post('/v1/e2ee/keys/prekeys')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        deviceId: deviceA.id,
        prekeys,
      })
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DEVICE_OWNERSHIP_REQUIRED');
  });

  it('should atomically claim distinct prekeys during concurrent bundle fetches without duplication', async () => {
    // 5 concurrent bundle requests targeting Device A
    const requests = Array.from({ length: 5 }, () =>
      request(app.getHttpServer())
        .get(`/v1/e2ee/keys/bundle/${deviceA.id}`)
        .set('Authorization', `Bearer ${tokenB}`),
    );

    const responses = await Promise.all(requests);
    responses.forEach((res) => {
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.oneTimePrekey).not.toBeNull();
      // Zero sensitive user private details leaked
      expect(res.body.data).not.toHaveProperty('privateKey');
      expect(res.body.data).not.toHaveProperty('passwordHash');
      expect(res.body.data).not.toHaveProperty('refreshToken');
    });

    const claimedKeyIds = responses.map((r) => r.body.data.oneTimePrekey.keyId);
    const uniqueKeyIds = new Set(claimedKeyIds);

    // All 5 consumed prekeys must be distinct!
    expect(uniqueKeyIds.size).toBe(5);
  });

  it('should return isDepleted: true when available prekeys fall below threshold (< 20)', async () => {
    // We uploaded 25 and consumed 5 -> exactly 20 left.
    // Let's consume 1 more to reach 19 (< 20)
    await request(app.getHttpServer())
      .get(`/v1/e2ee/keys/bundle/${deviceA.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(HttpStatus.OK);

    const statusRes = await request(app.getHttpServer())
      .get(`/v1/e2ee/keys/status/${deviceA.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(HttpStatus.OK);

    expect(statusRes.body.success).toBe(true);
    expect(statusRes.body.data.availablePrekeysCount).toBe(19);
    expect(statusRes.body.data.isDepleted).toBe(true);
  });
});

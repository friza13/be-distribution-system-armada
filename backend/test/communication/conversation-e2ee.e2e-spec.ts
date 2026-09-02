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

describe('E2E Conversation & Message Ingestion Service (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerUser: any;
  let ownerDevice: any;
  let ownerSession: any;
  let ownerToken: string;

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

  let createdConversationId: string;
  let sentMessageId: string;

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
        username: `chat_own_${Date.now()}`,
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

    // 2. Driver A Setup
    driverUserA = await prisma.user.create({
      data: {
        username: `chat_drv_a_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-CHT-A-${Date.now()}`, displayName: 'Driver Chat A', phone: driverUserA.phone },
    });
    driverDeviceA = await prisma.device.create({
      data: { userId: driverUserA.id, deviceIdentifier: `drva-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
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
        username: `chat_drv_b_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: { userId: driverUserB.id, employeeCode: `DRV-CHT-B-${Date.now()}`, displayName: 'Driver Chat B', phone: driverUserB.phone },
    });
    driverDeviceB = await prisma.device.create({
      data: { userId: driverUserB.id, deviceIdentifier: `drvb-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSessionB = await prisma.session.create({
      data: { userId: driverUserB.id, deviceId: driverDeviceB.id, refreshTokenHash: 'h_drvb', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverTokenB = jwt.sign(
      { sub: driverUserB.id, role: 'DRIVER', deviceId: driverDeviceB.id, sessionId: driverSessionB.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );
  });

  afterAll(async () => {
    if (createdConversationId) {
      await prisma.message.deleteMany({ where: { conversationId: createdConversationId } });
      await prisma.conversation.deleteMany({ where: { id: createdConversationId } });
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

  it('should create a 1:1 conversation between Owner and Driver A (POST /v1/conversations)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/conversations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ driverId: driverEntityA.id })
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.ownerId).toBe(ownerUser.id);
    expect(res.body.data.driverId).toBe(driverEntityA.id);

    createdConversationId = res.body.data.id;
  });

  it('should send an E2EE encrypted ciphertext message from Owner to Driver A (POST /v1/conversations/:id/messages)', async () => {
    const payload = {
      recipientDeviceId: driverDeviceA.id,
      protocolVersion: 1,
      ciphertextBlob: 'Base64EncryptedCiphertextBlobStringHere1234567890==',
      headerJson: { dhPublicKey: 'Base64DhKey', n: 1, pn: 0 },
    };

    const res = await request(app.getHttpServer())
      .post(`/v1/conversations/${createdConversationId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload)
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.ciphertextBlob).toBe(payload.ciphertextBlob);
    expect(res.body.data.senderUserId).toBe(ownerUser.id);

    sentMessageId = res.body.data.id;

    // Verify database record has ZERO plaintext
    const msgInDb = await prisma.message.findUnique({ where: { id: sentMessageId } });
    expect(msgInDb?.ciphertextBlob).toBe(payload.ciphertextBlob);
  });

  it('should allow Driver A (participant) to fetch conversation messages (GET /v1/conversations/:id/messages)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/conversations/${createdConversationId}/messages`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.messages.length).toBe(1);
    expect(res.body.data.messages[0].ciphertextBlob).toBeDefined();
  });

  it('should REJECT Driver B attempting to read messages in Owner-DriverA conversation (403 IDOR Defense)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/conversations/${createdConversationId}/messages`)
      .set('Authorization', `Bearer ${driverTokenB}`)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('should REJECT Driver B attempting to send message in Owner-DriverA conversation (403 IDOR Defense)', async () => {
    const payload = {
      recipientDeviceId: ownerDevice.id,
      ciphertextBlob: 'ForgedCiphertextBlob',
      headerJson: {},
    };

    const res = await request(app.getHttpServer())
      .post(`/v1/conversations/${createdConversationId}/messages`)
      .set('Authorization', `Bearer ${driverTokenB}`)
      .send(payload)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.error.code).toBe('RESOURCE_FORBIDDEN');
  });
});

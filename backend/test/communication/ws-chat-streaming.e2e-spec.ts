import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';
import { RealtimeEventEnvelope } from '../../src/modules/realtime/dto/realtime-envelope.dto';

describe('Realtime Chat Streaming & ACK Protocol (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let serverPort: number;

  let ownerUser: any;
  let ownerDevice: any;
  let ownerSession: any;
  let ownerToken: string;

  let driverUserA: any;
  let driverEntityA: any;
  let driverDeviceA: any;
  let driverSessionA: any;
  let driverTokenA: string;

  let conversationA: any;

  const secretKey = 'test_secret_with_minimum_32_characters_length_here';
  const issuer = 'dms-api';
  const audience = 'dms-clients';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    serverPort = typeof address === 'string' ? 0 : address.port;

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

    ownerUser = await prisma.user.create({
      data: {
        username: `wschat_own_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        phone: `+62818${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });
    ownerDevice = await prisma.device.create({
      data: { userId: ownerUser.id, deviceIdentifier: `own-${Date.now()}-${Math.floor(Math.random() * 10000)}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    ownerSession = await prisma.session.create({
      data: { userId: ownerUser.id, deviceId: ownerDevice.id, refreshTokenHash: 'h_own', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    ownerToken = jwt.sign(
      { sub: ownerUser.id, role: 'OWNER', deviceId: ownerDevice.id, sessionId: ownerSession.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    driverUserA = await prisma.user.create({
      data: {
        username: `wschat_drv_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        phone: `+62821${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-WSC-${Date.now()}-${Math.floor(Math.random() * 10000)}`, displayName: 'Driver WS Chat', phone: driverUserA.phone },
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

    conversationA = await prisma.conversation.create({
      data: { ownerId: ownerUser.id, driverId: driverEntityA.id },
    });
  });

  afterAll(async () => {
    if (conversationA) {
      await prisma.message.deleteMany({ where: { conversationId: conversationA.id } });
      await prisma.conversation.deleteMany({ where: { id: conversationA.id } });
    }
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

  function connect(token: string): Promise<Socket> {
    const wsUrl = `http://localhost:${serverPort}/v1/realtime`;
    const socket = io(wsUrl, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token: `Bearer ${token}` } });
    return new Promise((resolve) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', () => resolve(socket));
    });
  }

  it('should stream chat message via WebSocket and relay ciphertext to conversation room', async () => {
    const ownerClient = await connect(ownerToken);
    const driverClient = await connect(driverTokenA);

    expect(ownerClient.connected).toBe(true);
    expect(driverClient.connected).toBe(true);

    // Driver A joins conversation room
    const joinPromise = new Promise<any>((resolve) => {
      driverClient.on('room_joined', (data) => resolve(data));
    });
    driverClient.emit('join_room', { room: `conversation:${conversationA.id}` });
    await joinPromise;

    // Driver A sets up listener for relayed message
    const relayedPromise = new Promise<RealtimeEventEnvelope>((resolve) => {
      driverClient.on('chat.message.relayed', (event: RealtimeEventEnvelope) => {
        resolve(event);
      });
    });

    // Owner emits chat.message.send via WS
    ownerClient.emit('chat.message.send', {
      conversationId: conversationA.id,
      recipientDeviceId: driverDeviceA.id,
      protocolVersion: 1,
      ciphertextBlob: 'EncryptedPayloadViaWebSocket12345',
      headerJson: { dhKey: 'dh_key_base64' },
    });

    // Driver A receives relayed ciphertext message
    const event = await relayedPromise;
    expect(event).toBeDefined();
    expect(event.event).toBe('chat.message.relayed');
    expect((event.payload as any).ciphertextBlob).toBe('EncryptedPayloadViaWebSocket12345');

    ownerClient.disconnect();
    driverClient.disconnect();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';
import { formatRealtimeEvent, RealtimeEventEnvelope } from '../../src/modules/realtime/dto/realtime-envelope.dto';

describe('Canonical Realtime Event Envelope (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let serverPort: number;

  let testUser: any;
  let testDevice: any;
  let testSession: any;

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

    testUser = await prisma.user.create({
      data: {
        username: `ws_env_user_${Date.now()}`,
        phone: `+62823${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    testDevice = await prisma.device.create({
      data: {
        userId: testUser.id,
        deviceIdentifier: `env-dev-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
        status: 'ACTIVE',
      },
    });

    testSession = await prisma.session.create({
      data: {
        userId: testUser.id,
        deviceId: testDevice.id,
        refreshTokenHash: 'fake_hash',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
  });

  afterAll(async () => {
    if (testUser) {
      await prisma.session.deleteMany({ where: { userId: testUser.id } });
      await prisma.device.deleteMany({ where: { userId: testUser.id } });
      await prisma.user.delete({ where: { id: testUser.id } });
    }
    await app.close();
  });

  function createToken() {
    return jwt.sign(
      {
        sub: testUser.id,
        role: 'OWNER',
        deviceId: testDevice.id,
        sessionId: testSession.id,
        type: 'ACCESS_TOKEN',
      },
      secretKey,
      {
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer,
        audience,
        header: {
          alg: 'HS256',
          typ: 'JWT',
          kid: 'dms-2026-q3',
        },
      },
    );
  }

  it('should verify formatRealtimeEvent adheres strictly to ADR-007 canonical event schema', () => {
    const actor = {
      userId: testUser.id,
      role: 'OWNER',
      deviceId: testDevice.id,
      driverId: null,
    };

    const payload = {
      deliveryId: 'del-12345',
      status: 'EN_ROUTE',
    };

    const envelope: RealtimeEventEnvelope<typeof payload> = formatRealtimeEvent(
      'delivery.status_changed',
      payload,
      actor,
    );

    expect(envelope).toHaveProperty('eventId');
    expect(typeof envelope.eventId).toBe('string');
    expect(envelope.event).toBe('delivery.status_changed');
    expect(envelope.version).toBe(1);
    expect(envelope).toHaveProperty('timestamp');
    expect(new Date(envelope.timestamp).toISOString()).toBe(envelope.timestamp);
    expect(envelope).toHaveProperty('correlationId');
    expect(envelope.actor).toEqual(actor);
    expect(envelope.payload).toEqual(payload);
  });

  it('should emit connected event in standard canonical envelope format upon connection', async () => {
    const token = createToken();
    const wsUrl = `http://localhost:${serverPort}/v1/realtime`;

    const socket: Socket = io(wsUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: `Bearer ${token}` },
    });

    const connectedEventPromise = new Promise<RealtimeEventEnvelope>((resolve) => {
      socket.on('connected', (event: RealtimeEventEnvelope) => {
        resolve(event);
      });
    });

    const event = await connectedEventPromise;

    expect(event.event).toBe('realtime.connected');
    expect(event.version).toBe(1);
    expect(event.actor.userId).toBe(testUser.id);
    expect(event.actor.role).toBe('OWNER');
    expect(event.actor.deviceId).toBe(testDevice.id);
    expect(event.payload).toHaveProperty('socketId');
    expect(event.payload).toHaveProperty('connectedAt');

    socket.disconnect();
  });
});

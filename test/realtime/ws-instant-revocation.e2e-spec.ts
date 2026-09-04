import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RedisService } from '../../src/common/redis/redis.service';
import { hashPassword } from '../../src/common/utils/password.util';
import { WsConnectionManagerService } from '../../src/modules/realtime/services/ws-connection-manager.service';

describe('WebSocket Instant Revocation via Redis Pub/Sub (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let connectionManager: WsConnectionManagerService;
  let serverPort: number;

  let testUser1: any;
  let testUser2: any;
  let user1Device: any;
  let user2Device: any;
  let user1Session: any;
  let user2Session: any;

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
    redis = app.get(RedisService);
    connectionManager = app.get(WsConnectionManagerService);

    const ownerRole = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    testUser1 = await prisma.user.create({
      data: {
        username: `ws_rev_user1_${Date.now()}`,
        phone: `+62811${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    user1Device = await prisma.device.create({
      data: {
        userId: testUser1.id,
        deviceIdentifier: `dev1-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
        status: 'ACTIVE',
      },
    });

    user1Session = await prisma.session.create({
      data: {
        userId: testUser1.id,
        deviceId: user1Device.id,
        refreshTokenHash: 'hash1',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });

    testUser2 = await prisma.user.create({
      data: {
        username: `ws_rev_user2_${Date.now()}`,
        phone: `+62812${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    user2Device = await prisma.device.create({
      data: {
        userId: testUser2.id,
        deviceIdentifier: `dev2-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
        status: 'ACTIVE',
      },
    });

    user2Session = await prisma.session.create({
      data: {
        userId: testUser2.id,
        deviceId: user2Device.id,
        refreshTokenHash: 'hash2',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
  });

  afterAll(async () => {
    if (testUser1) {
      await prisma.session.deleteMany({ where: { userId: testUser1.id } });
      await prisma.device.deleteMany({ where: { userId: testUser1.id } });
      await prisma.user.delete({ where: { id: testUser1.id } });
    }
    if (testUser2) {
      await prisma.session.deleteMany({ where: { userId: testUser2.id } });
      await prisma.device.deleteMany({ where: { userId: testUser2.id } });
      await prisma.user.delete({ where: { id: testUser2.id } });
    }
    await app.close();
  });

  function createToken(user: any, device: any, session: any) {
    return jwt.sign(
      {
        sub: user.id,
        role: 'OWNER',
        deviceId: device.id,
        sessionId: session.id,
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

  function connectClient(token: string): Promise<Socket> {
    const wsUrl = `http://localhost:${serverPort}/v1/realtime`;
    const socket = io(wsUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: `Bearer ${token}` },
    });

    return new Promise((resolve) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', () => resolve(socket));
    });
  }

  it('should instantly disconnect socket when SESSION_REVOKED is published on Redis', async () => {
    const token1 = createToken(testUser1, user1Device, user1Session);
    const token2 = createToken(testUser2, user2Device, user2Session);

    const client1 = await connectClient(token1);
    const client2 = await connectClient(token2);

    expect(client1.connected).toBe(true);
    expect(client2.connected).toBe(true);

    const disconnectPromise1 = new Promise<any>((resolve) => {
      client1.on('disconnect_notice', (notice) => {
        resolve(notice);
      });
      client1.on('disconnect', () => {
        resolve({ event: 'disconnected' });
      });
    });

    // Publish SESSION_REVOKED for user1Session
    await redis.publish(
      'security:revocation',
      JSON.stringify({
        type: 'SESSION_REVOKED',
        sessionId: user1Session.id,
        userId: testUser1.id,
        reason: 'USER_LOGOUT',
      }),
    );

    const notice = await disconnectPromise1;
    expect(notice).toBeDefined();

    // Give socket brief moment to complete disconnection
    await new Promise((r) => setTimeout(r, 50));
    expect(client1.connected).toBe(false);

    // Verify client2 (unrelated user/session) remains connected and unaffected
    expect(client2.connected).toBe(true);

    client2.disconnect();
  });

  it('should instantly disconnect all user sockets when USER_REVOKED is published on Redis', async () => {
    // Create 2 devices/sessions for testUser1
    const devA = await prisma.device.create({
      data: {
        userId: testUser1.id,
        deviceIdentifier: `devA-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
      },
    });
    const sesA = await prisma.session.create({
      data: {
        userId: testUser1.id,
        deviceId: devA.id,
        refreshTokenHash: 'hashA',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });

    const devB = await prisma.device.create({
      data: {
        userId: testUser1.id,
        deviceIdentifier: `devB-${Date.now()}`,
        platform: 'WEB',
        appVersion: '1.0.0',
      },
    });
    const sesB = await prisma.session.create({
      data: {
        userId: testUser1.id,
        deviceId: devB.id,
        refreshTokenHash: 'hashB',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });

    const tokenA = createToken(testUser1, devA, sesA);
    const tokenB = createToken(testUser1, devB, sesB);
    const tokenUser2 = createToken(testUser2, user2Device, user2Session);

    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);
    const clientUser2 = await connectClient(tokenUser2);

    expect(clientA.connected).toBe(true);
    expect(clientB.connected).toBe(true);
    expect(clientUser2.connected).toBe(true);

    // Publish USER_REVOKED for testUser1
    await redis.publish(
      'security:revocation',
      JSON.stringify({
        type: 'USER_REVOKED',
        userId: testUser1.id,
        reason: 'ACCOUNT_DISABLED',
      }),
    );

    await new Promise((r) => setTimeout(r, 60));

    expect(clientA.connected).toBe(false);
    expect(clientB.connected).toBe(false);
    expect(clientUser2.connected).toBe(true);

    clientUser2.disconnect();
    await prisma.session.deleteMany({ where: { id: { in: [sesA.id, sesB.id] } } });
    await prisma.device.deleteMany({ where: { id: { in: [devA.id, devB.id] } } });
  });

  it('should be completely idempotent when duplicate revocation events are published', async () => {
    // Publishing duplicate revocation events should not crash or throw unhandled exceptions
    await redis.publish(
      'security:revocation',
      JSON.stringify({
        type: 'SESSION_REVOKED',
        sessionId: 'non-existent-session-id',
        reason: 'REPEAT_TEST',
      }),
    );

    await redis.publish(
      'security:revocation',
      JSON.stringify({
        type: 'USER_REVOKED',
        userId: 'non-existent-user-id',
        reason: 'REPEAT_TEST',
      }),
    );

    // Publish malformed JSON message to verify gateway safety
    await redis.publish('security:revocation', '{ malformed json !!');

    await new Promise((r) => setTimeout(r, 50));
    expect(connectionManager.getActiveConnectionCount()).toBe(0);
  });
});

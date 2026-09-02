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

describe('WebSocket Handshake & JWT Authentication (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let connectionManager: WsConnectionManagerService;
  let serverPort: number;

  let testOwnerUser: any;
  let testDriverUser: any;
  let testDriverEntity: any;
  let ownerSession: any;
  let driverSession: any;
  let ownerDevice: any;
  let driverDevice: any;

  const secretKey = 'test_secret_with_minimum_32_characters_length_here';
  const issuer = 'dms-api';
  const audience = 'dms-clients';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0); // Random available port

    const address = app.getHttpServer().address();
    serverPort = typeof address === 'string' ? 0 : address.port;

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    connectionManager = app.get(WsConnectionManagerService);

    // Seed Roles
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

    // Create Test Owner
    testOwnerUser = await prisma.user.create({
      data: {
        username: `ws_owner_${Date.now()}`,
        phone: `+62812${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    ownerDevice = await prisma.device.create({
      data: {
        userId: testOwnerUser.id,
        deviceIdentifier: `owner-dev-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
        status: 'ACTIVE',
      },
    });

    ownerSession = await prisma.session.create({
      data: {
        userId: testOwnerUser.id,
        deviceId: ownerDevice.id,
        refreshTokenHash: 'fake_hash',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });

    // Create Test Driver
    testDriverUser = await prisma.user.create({
      data: {
        username: `ws_driver_${Date.now()}`,
        phone: `+62813${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });

    testDriverEntity = await prisma.driver.create({
      data: {
        userId: testDriverUser.id,
        employeeCode: `EMP-${Date.now()}`,
        displayName: 'Test WS Driver',
        phone: testDriverUser.phone,
      },
    });

    driverDevice = await prisma.device.create({
      data: {
        userId: testDriverUser.id,
        deviceIdentifier: `driver-dev-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
        status: 'ACTIVE',
      },
    });

    driverSession = await prisma.session.create({
      data: {
        userId: testDriverUser.id,
        deviceId: driverDevice.id,
        refreshTokenHash: 'fake_hash_driver',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
  });

  afterAll(async () => {
    if (testOwnerUser) {
      await prisma.session.deleteMany({ where: { userId: testOwnerUser.id } });
      await prisma.device.deleteMany({ where: { userId: testOwnerUser.id } });
      await prisma.user.delete({ where: { id: testOwnerUser.id } });
    }
    if (testDriverUser) {
      await prisma.driver.deleteMany({ where: { userId: testDriverUser.id } });
      await prisma.session.deleteMany({ where: { userId: testDriverUser.id } });
      await prisma.device.deleteMany({ where: { userId: testDriverUser.id } });
      await prisma.user.delete({ where: { id: testDriverUser.id } });
    }
    await app.close();
  });

  function createValidToken(user: any, device: any, session: any, roleCode: string) {
    return jwt.sign(
      {
        sub: user.id,
        role: roleCode,
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

  function connectClient(token?: string, authParam = true, queryParam = false): Promise<Socket> {
    const wsUrl = `http://localhost:${serverPort}/v1/realtime`;
    const opts: any = {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    };

    if (token) {
      if (authParam) {
        opts.auth = { token: `Bearer ${token}` };
      }
      if (queryParam) {
        opts.query = { token };
      }
    }

    const socket = io(wsUrl, opts);

    return new Promise((resolve, reject) => {
      socket.on('connect', () => {
        resolve(socket);
      });
      socket.on('connect_error', (err) => {
        resolve(socket); // Resolve socket with error state
      });
    });
  }

  it('should successfully authenticate and connect with a valid JWT in auth.token', async () => {
    const token = createValidToken(testOwnerUser, ownerDevice, ownerSession, 'OWNER');
    const client = await connectClient(token, true, false);

    expect(client.connected).toBe(true);

    // Verify Socket context in WsConnectionManagerService
    const registered = connectionManager.getSocket(client.id);
    expect(registered).toBeDefined();
    expect(registered?.data.userId).toBe(testOwnerUser.id);
    expect(registered?.data.role).toBe('OWNER');
    expect(registered?.data.deviceId).toBe(ownerDevice.id);
    expect(registered?.data.sessionId).toBe(ownerSession.id);

    client.disconnect();
  });

  it('should successfully authenticate and connect Driver socket with driverId context', async () => {
    const token = createValidToken(testDriverUser, driverDevice, driverSession, 'DRIVER');
    const client = await connectClient(token, true, false);

    expect(client.connected).toBe(true);

    const registered = connectionManager.getSocket(client.id);
    expect(registered).toBeDefined();
    expect(registered?.data.userId).toBe(testDriverUser.id);
    expect(registered?.data.role).toBe('DRIVER');
    expect(registered?.data.driverId).toBe(testDriverEntity.id);

    client.disconnect();
  });

  it('should successfully authenticate with a valid JWT in query.token', async () => {
    const token = createValidToken(testOwnerUser, ownerDevice, ownerSession, 'OWNER');
    const client = await connectClient(token, false, true);

    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('should reject handshake when token is missing', async () => {
    const client = await connectClient(undefined, false, false);
    expect(client.connected).toBe(false);
    client.disconnect();
  });

  it('should reject handshake when token is malformed', async () => {
    const client = await connectClient('not.a.valid.jwt.token', true, false);
    expect(client.connected).toBe(false);
    client.disconnect();
  });

  it('should reject handshake when token is expired', async () => {
    const expiredToken = jwt.sign(
      {
        sub: testOwnerUser.id,
        role: 'OWNER',
        deviceId: ownerDevice.id,
        sessionId: ownerSession.id,
        type: 'ACCESS_TOKEN',
      },
      secretKey,
      {
        algorithm: 'HS256',
        expiresIn: '-10s', // Expired 10s ago
        issuer,
        audience,
      },
    );

    const client = await connectClient(expiredToken, true, false);
    expect(client.connected).toBe(false);
    client.disconnect();
  });

  it('should reject handshake when signature is invalid (wrong secret)', async () => {
    const forgedToken = jwt.sign(
      {
        sub: testOwnerUser.id,
        role: 'OWNER',
        deviceId: ownerDevice.id,
        sessionId: ownerSession.id,
        type: 'ACCESS_TOKEN',
      },
      'unauthorized_attacker_signing_key_here_123',
      {
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer,
        audience,
      },
    );

    const client = await connectClient(forgedToken, true, false);
    expect(client.connected).toBe(false);
    client.disconnect();
  });

  it('should reject handshake with invalid issuer', async () => {
    const token = jwt.sign(
      {
        sub: testOwnerUser.id,
        role: 'OWNER',
        deviceId: ownerDevice.id,
        sessionId: ownerSession.id,
        type: 'ACCESS_TOKEN',
      },
      secretKey,
      {
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer: 'malicious-issuer',
        audience,
      },
    );

    const client = await connectClient(token, true, false);
    expect(client.connected).toBe(false);
    client.disconnect();
  });

  it('should reject handshake with invalid audience', async () => {
    const token = jwt.sign(
      {
        sub: testOwnerUser.id,
        role: 'OWNER',
        deviceId: ownerDevice.id,
        sessionId: ownerSession.id,
        type: 'ACCESS_TOKEN',
      },
      secretKey,
      {
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer,
        audience: 'wrong-audience',
      },
    );

    const client = await connectClient(token, true, false);
    expect(client.connected).toBe(false);
    client.disconnect();
  });

  it('should reject handshake when token type is not ACCESS_TOKEN', async () => {
    const token = jwt.sign(
      {
        sub: testOwnerUser.id,
        role: 'OWNER',
        deviceId: ownerDevice.id,
        sessionId: ownerSession.id,
        type: 'REFRESH_TOKEN',
      },
      secretKey,
      {
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer,
        audience,
      },
    );

    const client = await connectClient(token, true, false);
    expect(client.connected).toBe(false);
    client.disconnect();
  });

  it('should reject handshake when session is revoked in Redis', async () => {
    const token = createValidToken(testOwnerUser, ownerDevice, ownerSession, 'OWNER');

    // Mark session revoked in Redis
    await redis.setRevocation(`revoked:session:${ownerSession.id}`, 60);

    const client = await connectClient(token, true, false);
    expect(client.connected).toBe(false);

    // Clean up redis
    await redis.resetRateLimit(`revoked:session:${ownerSession.id}`);
    client.disconnect();
  });

  it('should reject handshake when user is revoked in Redis', async () => {
    const token = createValidToken(testOwnerUser, ownerDevice, ownerSession, 'OWNER');

    // Mark user revoked in Redis
    await redis.setRevocation(`revoked:user:${testOwnerUser.id}`, 60);

    const client = await connectClient(token, true, false);
    expect(client.connected).toBe(false);

    // Clean up redis
    await redis.resetRateLimit(`revoked:user:${testOwnerUser.id}`);
    client.disconnect();
  });

  it('should reject handshake when account is inactive/suspended/disabled', async () => {
    // Create suspended user
    const suspendedUser = await prisma.user.create({
      data: {
        username: `ws_suspended_${Date.now()}`,
        phone: `+62814${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: testOwnerUser.roleId,
        status: 'SUSPENDED',
      },
    });

    const token = createValidToken(suspendedUser, ownerDevice, ownerSession, 'OWNER');
    const client = await connectClient(token, true, false);
    expect(client.connected).toBe(false);

    await prisma.user.delete({ where: { id: suspendedUser.id } });
    client.disconnect();
  });

  it('should reject handshake when user role mutated (ROLE_UPDATED_REAUTH_REQUIRED)', async () => {
    // Token says role is DRIVER, but DB user is OWNER
    const token = createValidToken(testOwnerUser, ownerDevice, ownerSession, 'DRIVER');

    const client = await connectClient(token, true, false);
    expect(client.connected).toBe(false);
    client.disconnect();
  });
});

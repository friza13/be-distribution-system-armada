import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';
import { WsConnectionManagerService } from '../../src/modules/realtime/services/ws-connection-manager.service';
import { RealtimeGateway } from '../../src/modules/realtime/gateways/realtime.gateway';

describe('WebSocket Heartbeat, Latency & Stale Teardown (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let connectionManager: WsConnectionManagerService;
  let gateway: RealtimeGateway;
  let serverPort: number;

  let testUser: any;
  let testDevice: any;
  let testSession: any;

  const secretKey = 'test_secret_with_minimum_32_characters_length_here';
  const issuer = 'dms-api';
  const audience = 'dms-clients';

  beforeAll(async () => {
    // Override heartbeat timing for fast, deterministic testing: 200ms ping, 100ms timeout
    process.env.WS_HEARTBEAT_INTERVAL_MS = '200';
    process.env.WS_PONG_TIMEOUT_MS = '100';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    serverPort = typeof address === 'string' ? 0 : address.port;

    prisma = app.get(PrismaService);
    connectionManager = app.get(WsConnectionManagerService);
    gateway = app.get(RealtimeGateway);

    const ownerRole = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    testUser = await prisma.user.create({
      data: {
        username: `ws_hb_user_${Date.now()}`,
        phone: `+62817${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    testDevice = await prisma.device.create({
      data: {
        userId: testUser.id,
        deviceIdentifier: `hb-dev-${Date.now()}`,
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
    delete process.env.WS_HEARTBEAT_INTERVAL_MS;
    delete process.env.WS_PONG_TIMEOUT_MS;

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

  function connectClient(autoRespondPong = true): Promise<Socket> {
    const wsUrl = `http://localhost:${serverPort}/v1/realtime`;
    const socket = io(wsUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: `Bearer ${createToken()}` },
    });

    if (autoRespondPong) {
      socket.on('ping', (data: { serverTime: number }) => {
        socket.emit('pong', {
          clientTime: Date.now(),
          pingServerTime: data.serverTime,
        });
      });
    }

    return new Promise((resolve) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', () => resolve(socket));
    });
  }

  it('should send server ping, receive client pong, and record RTT latency accurately', async () => {
    const client = await connectClient(true);
    expect(client.connected).toBe(true);

    // Wait for at least one heartbeat cycle to complete
    await new Promise((r) => setTimeout(r, 250));

    const serverSocket = connectionManager.getSocket(client.id);
    expect(serverSocket).toBeDefined();
    expect(serverSocket?.data.lastPingSentAt).toBeDefined();
    expect(serverSocket?.data.lastPongReceivedAt).toBeDefined();
    expect(serverSocket?.data.rttLatencyMs).toBeGreaterThanOrEqual(0);

    client.disconnect();
  });

  it('should keep healthy connection alive as long as pongs are received', async () => {
    const client = await connectClient(true);
    expect(client.connected).toBe(true);

    // Wait across 3 heartbeat intervals (600ms)
    await new Promise((r) => setTimeout(r, 600));

    expect(client.connected).toBe(true);
    expect(connectionManager.getSocket(client.id)).toBeDefined();

    client.disconnect();
  });

  it('should teardown zombie socket when client fails to respond to ping within pong timeout', async () => {
    // Connect client that NEVER responds to ping (zombie simulation)
    const zombieClient = await connectClient(false);
    expect(zombieClient.connected).toBe(true);

    const disconnectNoticePromise = new Promise<any>((resolve) => {
      zombieClient.on('disconnect_notice', (notice) => {
        resolve(notice);
      });
    });

    // Manually trigger a ping or wait for interval
    const serverSocket = connectionManager.getSocket(zombieClient.id);
    if (serverSocket) {
      gateway.sendHeartbeatPing(serverSocket);
    }

    // Wait for pong timeout (100ms) + small buffer
    const notice = await disconnectNoticePromise;
    expect(notice).toBeDefined();
    expect(notice.reason).toBe('STALE_HEARTBEAT_TIMEOUT');

    await new Promise((r) => setTimeout(r, 50));
    expect(zombieClient.connected).toBe(false);

    // Verify socket removed from connectionManager
    expect(connectionManager.getSocket(zombieClient.id)).toBeUndefined();
  });

  it('should clean up heartbeat timers properly on manual disconnect', async () => {
    const client = await connectClient(true);
    const serverSocket = connectionManager.getSocket(client.id);
    expect(serverSocket?.data.heartbeatIntervalTimer).toBeDefined();

    client.disconnect();

    await new Promise((r) => setTimeout(r, 50));
    expect(connectionManager.getSocket(client.id)).toBeUndefined();
  });
});

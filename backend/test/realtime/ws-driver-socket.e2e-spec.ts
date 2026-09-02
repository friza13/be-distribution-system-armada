import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';
import { WsConnectionManagerService } from '../../src/modules/realtime/services/ws-connection-manager.service';

describe('Driver Single Active Socket Policy (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let connectionManager: WsConnectionManagerService;
  let serverPort: number;

  let testDriverUser: any;
  let testDriverEntity: any;
  let driverDevice1: any;
  let driverDevice2: any;
  let driverSession1: any;
  let driverSession2: any;

  let testOwnerUser: any;
  let ownerDevice1: any;
  let ownerDevice2: any;
  let ownerSession1: any;
  let ownerSession2: any;

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
    connectionManager = app.get(WsConnectionManagerService);

    const driverRole = await prisma.role.upsert({
      where: { code: 'DRIVER' },
      update: {},
      create: { code: 'DRIVER', name: 'Driver' },
    });

    const ownerRole = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    // Create Test Driver
    testDriverUser = await prisma.user.create({
      data: {
        username: `ws_single_drv_${Date.now()}`,
        phone: `+62815${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });

    testDriverEntity = await prisma.driver.create({
      data: {
        userId: testDriverUser.id,
        employeeCode: `DRV-SNG-${Date.now()}`,
        displayName: 'Single Socket Driver',
        phone: testDriverUser.phone,
      },
    });

    driverDevice1 = await prisma.device.create({
      data: {
        userId: testDriverUser.id,
        deviceIdentifier: `drv-dev1-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
      },
    });

    driverSession1 = await prisma.session.create({
      data: {
        userId: testDriverUser.id,
        deviceId: driverDevice1.id,
        refreshTokenHash: 'hash_drv1',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });

    driverDevice2 = await prisma.device.create({
      data: {
        userId: testDriverUser.id,
        deviceIdentifier: `drv-dev2-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
      },
    });

    driverSession2 = await prisma.session.create({
      data: {
        userId: testDriverUser.id,
        deviceId: driverDevice2.id,
        refreshTokenHash: 'hash_drv2',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });

    // Create Test Owner (for Multi-Socket comparison)
    testOwnerUser = await prisma.user.create({
      data: {
        username: `ws_multi_own_${Date.now()}`,
        phone: `+62816${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    ownerDevice1 = await prisma.device.create({
      data: {
        userId: testOwnerUser.id,
        deviceIdentifier: `own-dev1-${Date.now()}`,
        platform: 'WEB',
        appVersion: '1.0.0',
      },
    });

    ownerSession1 = await prisma.session.create({
      data: {
        userId: testOwnerUser.id,
        deviceId: ownerDevice1.id,
        refreshTokenHash: 'hash_own1',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });

    ownerDevice2 = await prisma.device.create({
      data: {
        userId: testOwnerUser.id,
        deviceIdentifier: `own-dev2-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
      },
    });

    ownerSession2 = await prisma.session.create({
      data: {
        userId: testOwnerUser.id,
        deviceId: ownerDevice2.id,
        refreshTokenHash: 'hash_own2',
        tokenFamily: uuidv4(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
  });

  afterAll(async () => {
    if (testDriverUser) {
      await prisma.driver.deleteMany({ where: { userId: testDriverUser.id } });
      await prisma.session.deleteMany({ where: { userId: testDriverUser.id } });
      await prisma.device.deleteMany({ where: { userId: testDriverUser.id } });
      await prisma.user.delete({ where: { id: testDriverUser.id } });
    }
    if (testOwnerUser) {
      await prisma.session.deleteMany({ where: { userId: testOwnerUser.id } });
      await prisma.device.deleteMany({ where: { userId: testOwnerUser.id } });
      await prisma.user.delete({ where: { id: testOwnerUser.id } });
    }
    await app.close();
  });

  function createToken(user: any, device: any, session: any, roleCode: string) {
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

  it('should automatically sever older Driver socket with reason SUPERSEDED_BY_NEW_LOGIN when new socket connects', async () => {
    const token1 = createToken(testDriverUser, driverDevice1, driverSession1, 'DRIVER');
    const token2 = createToken(testDriverUser, driverDevice2, driverSession2, 'DRIVER');

    // 1. Driver connects first socket (Device 1)
    const socket1 = await connectClient(token1);
    expect(socket1.connected).toBe(true);

    const disconnectNoticePromise = new Promise<any>((resolve) => {
      socket1.on('disconnect_notice', (notice) => {
        resolve(notice);
      });
    });

    // 2. Driver connects second socket (Device 2)
    const socket2 = await connectClient(token2);
    expect(socket2.connected).toBe(true);

    // 3. Verify socket 1 receives disconnect_notice with reason SUPERSEDED_BY_NEW_LOGIN
    const notice = await disconnectNoticePromise;
    expect(notice).toBeDefined();
    expect(notice.reason).toBe('SUPERSEDED_BY_NEW_LOGIN');

    await new Promise((r) => setTimeout(r, 50));
    expect(socket1.connected).toBe(false);

    // 4. Verify ONLY socket2 is active in connectionManager for this driver
    const driverSocket = connectionManager.getSocketByDriverId(testDriverEntity.id);
    expect(driverSocket).toBeDefined();
    expect(driverSocket?.id).toBe(socket2.id);

    socket2.disconnect();
  });

  it('should allow Owner to have multiple simultaneous active sockets without superseding', async () => {
    const ownerToken1 = createToken(testOwnerUser, ownerDevice1, ownerSession1, 'OWNER');
    const ownerToken2 = createToken(testOwnerUser, ownerDevice2, ownerSession2, 'OWNER');

    const ownerSocket1 = await connectClient(ownerToken1);
    const ownerSocket2 = await connectClient(ownerToken2);

    expect(ownerSocket1.connected).toBe(true);
    expect(ownerSocket2.connected).toBe(true);

    const ownerSockets = connectionManager.getSocketsByUserId(testOwnerUser.id);
    expect(ownerSockets.length).toBe(2);

    ownerSocket1.disconnect();
    ownerSocket2.disconnect();
  });
});

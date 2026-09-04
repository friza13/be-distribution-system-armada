import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RoutesDomainService } from '../../src/modules/routes/services/routes-domain.service';
import { RealtimeEventEnvelope } from '../../src/modules/realtime/dto/realtime-envelope.dto';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Realtime Route Broadcast via WebSocket (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let routesDomainService: RoutesDomainService;
  let serverPort: number;

  let ownerUser: any;
  let ownerDevice: any;
  let ownerSession: any;
  let ownerToken: string;

  let driverUserA: any;
  let driverEntityA: any;

  let deliveryA: any;
  let stopA1: any;
  let stopA2: any;

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
    routesDomainService = app.get(RoutesDomainService);

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
        username: `ws_route_own_${Date.now()}`,
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

    driverUserA = await prisma.user.create({
      data: {
        username: `ws_route_drv_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });

    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-WSRTE-${Date.now()}`, displayName: 'WS Route Driver', phone: driverUserA.phone },
    });

    deliveryA = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-WSRTE-${Date.now()}`,
        driverId: driverEntityA.id,
        createdBy: ownerUser.id,
        status: 'ASSIGNED',
        routeMode: 'RECOMMENDED_2OPT',
      },
    });

    stopA1 = await prisma.deliveryStop.create({
      data: { deliveryId: deliveryA.id, sequence: 1, destinationName: 'Stop 1', address: 'Addr 1', latitude: -6.1754, longitude: 106.8272 },
    });

    stopA2 = await prisma.deliveryStop.create({
      data: { deliveryId: deliveryA.id, sequence: 2, destinationName: 'Stop 2', address: 'Addr 2', latitude: -6.1950, longitude: 106.8230 },
    });
  });

  afterAll(async () => {
    if (deliveryA) {
      await prisma.routeStop.deleteMany({ where: { route: { deliveryId: deliveryA.id } } });
      await prisma.route.deleteMany({ where: { deliveryId: deliveryA.id } });
      await prisma.deliveryStop.deleteMany({ where: { deliveryId: deliveryA.id } });
      await prisma.delivery.delete({ where: { id: deliveryA.id } });
    }
    if (driverUserA) {
      await prisma.driver.deleteMany({ where: { userId: driverUserA.id } });
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

  it('should broadcast delivery.route.updated to room delivery:<id> when a route is selected', async () => {
    const ownerClient = await connect(ownerToken);
    expect(ownerClient.connected).toBe(true);

    // Join room delivery:<deliveryA.id>
    const joinPromise = new Promise<any>((resolve) => {
      ownerClient.on('room_joined', (data) => resolve(data));
    });
    ownerClient.emit('join_room', { room: `delivery:${deliveryA.id}` });
    await joinPromise;

    // Register listener for delivery.route.updated event
    const routeUpdatedPromise = new Promise<RealtimeEventEnvelope>((resolve) => {
      ownerClient.on('delivery.route.updated', (event: RealtimeEventEnvelope) => {
        resolve(event);
      });
    });

    // Select Route
    await routesDomainService.selectRoute(
      deliveryA.id,
      {
        source: 'RECOMMENDED_2OPT',
        recommendedSequence: [stopA1.id, stopA2.id],
        totalDistanceMeters: 2200,
        estimatedDurationSeconds: 260,
      },
      {
        userId: ownerUser.id,
        role: 'OWNER',
        driverId: null,
      },
    );

    const event = await routeUpdatedPromise;
    expect(event).toBeDefined();
    expect(event.event).toBe('delivery.route.updated');
    expect(event.version).toBe(1);
    expect((event.payload as any).deliveryId).toBe(deliveryA.id);
    expect((event.payload as any).version).toBeGreaterThan(0);

    ownerClient.disconnect();
  });
});

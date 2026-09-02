import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { DeliveriesService } from '../../src/modules/deliveries/services/deliveries.service';
import { DeliveryStopsService } from '../../src/modules/deliveries/services/delivery-stops.service';
import { PodService } from '../../src/modules/pod/services/pod.service';
import { RealtimeEventEnvelope } from '../../src/modules/realtime/dto/realtime-envelope.dto';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Realtime Status Propagation via WebSocket (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let deliveriesService: DeliveriesService;
  let deliveryStopsService: DeliveryStopsService;
  let podService: PodService;
  let serverPort: number;

  let ownerUser: any;
  let ownerDevice: any;
  let ownerSession: any;
  let ownerToken: string;

  let driverUserA: any;
  let driverEntityA: any;

  let deliveryA: any;
  let stopA1: any;

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
    deliveriesService = app.get(DeliveriesService);
    deliveryStopsService = app.get(DeliveryStopsService);
    podService = app.get(PodService);

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
        username: `ws_del_own_${Date.now()}`,
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
        username: `ws_del_drv_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });

    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-WSDEL-${Date.now()}`, displayName: 'WS Delivery Driver', phone: driverUserA.phone },
    });

    deliveryA = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-WSDEL-${Date.now()}`,
        driverId: driverEntityA.id,
        createdBy: ownerUser.id,
        status: 'ACCEPTED',
      },
    });

    stopA1 = await prisma.deliveryStop.create({
      data: { deliveryId: deliveryA.id, sequence: 1, destinationName: 'Stop Monas', address: 'Addr 1', latitude: -6.1754, longitude: 106.8272 },
    });
  });

  afterAll(async () => {
    if (deliveryA) {
      await prisma.proofOfDelivery.deleteMany({ where: { deliveryStopId: stopA1.id } });
      await prisma.deliveryEvent.deleteMany({ where: { deliveryId: deliveryA.id } });
      await prisma.deliveryStop.deleteMany({ where: { deliveryId: deliveryA.id } });
      await prisma.delivery.deleteMany({ where: { id: deliveryA.id } });
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

  it('should broadcast delivery.status_changed to room delivery:<id> when delivery starts', async () => {
    const ownerClient = await connect(ownerToken);
    expect(ownerClient.connected).toBe(true);

    // Join room delivery:<deliveryA.id>
    const joinPromise = new Promise<any>((resolve) => {
      ownerClient.on('room_joined', (data) => resolve(data));
    });
    ownerClient.emit('join_room', { room: `delivery:${deliveryA.id}` });
    await joinPromise;

    const statusChangedPromise = new Promise<RealtimeEventEnvelope>((resolve) => {
      ownerClient.on('delivery.status_changed', (event: RealtimeEventEnvelope) => {
        resolve(event);
      });
    });

    // Start delivery
    await deliveriesService.startDelivery(deliveryA.id, driverEntityA.id, driverUserA.id);

    const event = await statusChangedPromise;
    expect(event).toBeDefined();
    expect(event.event).toBe('delivery.status_changed');
    expect((event.payload as any).status).toBe('EN_ROUTE');

    ownerClient.disconnect();
  });

  it('should broadcast delivery.stop.status_changed when stop status is updated', async () => {
    const ownerClient = await connect(ownerToken);
    expect(ownerClient.connected).toBe(true);

    const joinPromise = new Promise<any>((resolve) => {
      ownerClient.on('room_joined', (data) => resolve(data));
    });
    ownerClient.emit('join_room', { room: `delivery:${deliveryA.id}` });
    await joinPromise;

    const stopStatusPromise = new Promise<RealtimeEventEnvelope>((resolve) => {
      ownerClient.on('delivery.stop.status_changed', (event: RealtimeEventEnvelope) => {
        resolve(event);
      });
    });

    // Arrive at stop
    await deliveryStopsService.arriveAtStop(stopA1.id, driverEntityA.id, driverUserA.id);

    const event = await stopStatusPromise;
    expect(event).toBeDefined();
    expect(event.event).toBe('delivery.stop.status_changed');
    expect((event.payload as any).status).toBe('ARRIVED');

    ownerClient.disconnect();
  });
});

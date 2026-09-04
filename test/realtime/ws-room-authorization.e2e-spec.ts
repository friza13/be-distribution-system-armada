import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';
import { WsConnectionManagerService } from '../../src/modules/realtime/services/ws-connection-manager.service';

describe('Room & Channel Authorization Anti-IDOR (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let connectionManager: WsConnectionManagerService;
  let serverPort: number;

  let driverUserA: any;
  let driverEntityA: any;
  let driverDeviceA: any;
  let driverSessionA: any;

  let driverUserB: any;
  let driverEntityB: any;
  let driverDeviceB: any;
  let driverSessionB: any;

  let ownerUser: any;
  let ownerDevice: any;
  let ownerSession: any;

  let adminUser: any;
  let adminDevice: any;
  let adminSession: any;

  let deliveryA: any;
  let deliveryB: any;
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

    const adminRole = await prisma.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', name: 'Admin' },
    });

    // 1. Owner & Admin setup
    ownerUser = await prisma.user.create({
      data: {
        username: `ws_room_own_${Date.now()}`,
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
      data: { userId: ownerUser.id, deviceId: ownerDevice.id, refreshTokenHash: 'h_own', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 7 * 86400000) },
    });

    adminUser = await prisma.user.create({
      data: {
        username: `ws_room_adm_${Date.now()}`,
        phone: `+62819${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: adminRole.id,
        status: 'ACTIVE',
      },
    });
    adminDevice = await prisma.device.create({
      data: { userId: adminUser.id, deviceIdentifier: `adm-${Date.now()}`, platform: 'WEB', appVersion: '1.0.0' },
    });
    adminSession = await prisma.session.create({
      data: { userId: adminUser.id, deviceId: adminDevice.id, refreshTokenHash: 'h_adm', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 7 * 86400000) },
    });

    // 2. Driver A setup
    driverUserA = await prisma.user.create({
      data: {
        username: `ws_drv_a_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-A-${Date.now()}`, displayName: 'Driver Alpha', phone: driverUserA.phone },
    });
    driverDeviceA = await prisma.device.create({
      data: { userId: driverUserA.id, deviceIdentifier: `drva-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSessionA = await prisma.session.create({
      data: { userId: driverUserA.id, deviceId: driverDeviceA.id, refreshTokenHash: 'h_drva', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 7 * 86400000) },
    });

    // 3. Driver B setup
    driverUserB = await prisma.user.create({
      data: {
        username: `ws_drv_b_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: { userId: driverUserB.id, employeeCode: `DRV-B-${Date.now()}`, displayName: 'Driver Bravo', phone: driverUserB.phone },
    });
    driverDeviceB = await prisma.device.create({
      data: { userId: driverUserB.id, deviceIdentifier: `drvb-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    driverSessionB = await prisma.session.create({
      data: { userId: driverUserB.id, deviceId: driverDeviceB.id, refreshTokenHash: 'h_drvb', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 7 * 86400000) },
    });

    // 4. Deliveries
    deliveryA = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-A-${Date.now()}`,
        driverId: driverEntityA.id,
        createdBy: ownerUser.id,
        status: 'ASSIGNED',
      },
    });

    deliveryB = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-B-${Date.now()}`,
        driverId: driverEntityB.id,
        createdBy: ownerUser.id,
        status: 'ASSIGNED',
      },
    });

    // 5. Conversation (Owner <-> Driver A)
    conversationA = await prisma.conversation.create({
      data: {
        ownerId: ownerUser.id,
        driverId: driverEntityA.id,
      },
    });
  });

  afterAll(async () => {
    if (conversationA) await prisma.conversation.deleteMany({ where: { id: conversationA.id } });
    if (deliveryA) await prisma.delivery.deleteMany({ where: { id: deliveryA.id } });
    if (deliveryB) await prisma.delivery.deleteMany({ where: { id: deliveryB.id } });

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
    if (adminUser) {
      await prisma.session.deleteMany({ where: { userId: adminUser.id } });
      await prisma.device.deleteMany({ where: { userId: adminUser.id } });
      await prisma.user.delete({ where: { id: adminUser.id } });
    }
    await app.close();
  });

  function createToken(user: any, device: any, session: any, role: string) {
    return jwt.sign(
      { sub: user.id, role, deviceId: device.id, sessionId: session.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );
  }

  function connect(token: string): Promise<Socket> {
    const wsUrl = `http://localhost:${serverPort}/v1/realtime`;
    const socket = io(wsUrl, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token: `Bearer ${token}` } });
    return new Promise((resolve) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', () => resolve(socket));
    });
  }

  it('should ALLOW Driver A to join delivery room of their own assigned delivery (delivery:<deliveryA>)', async () => {
    const tokenA = createToken(driverUserA, driverDeviceA, driverSessionA, 'DRIVER');
    const clientA = await connect(tokenA);
    expect(clientA.connected).toBe(true);

    const joinPromise = new Promise<any>((resolve) => {
      clientA.on('room_joined', (data) => resolve({ status: 'JOINED', data }));
      clientA.on('room_error', (err) => resolve({ status: 'ERROR', err }));
    });

    clientA.emit('join_room', { room: `delivery:${deliveryA.id}` });
    const result = await joinPromise;

    expect(result.status).toBe('JOINED');
    expect(result.data.payload.room).toBe(`delivery:${deliveryA.id}`);
    expect(result.data.actor.userId).toBe(driverUserA.id);

    clientA.disconnect();
  });

  it('should REJECT Driver A attempting to join Driver B delivery room (Anti-IDOR protection)', async () => {
    const tokenA = createToken(driverUserA, driverDeviceA, driverSessionA, 'DRIVER');
    const clientA = await connect(tokenA);
    expect(clientA.connected).toBe(true);

    const joinPromise = new Promise<any>((resolve) => {
      clientA.on('room_joined', (data) => resolve({ status: 'JOINED', data }));
      clientA.on('room_error', (err) => resolve({ status: 'ERROR', err }));
    });

    // Driver A attempts to join Driver B's delivery
    clientA.emit('join_room', { room: `delivery:${deliveryB.id}` });
    const result = await joinPromise;

    expect(result.status).toBe('ERROR');
    expect(result.err.code).toBe('ROOM_ACCESS_DENIED');

    clientA.disconnect();
  });

  it('should REJECT Driver A attempting to join fleet:monitoring (Role boundary protection)', async () => {
    const tokenA = createToken(driverUserA, driverDeviceA, driverSessionA, 'DRIVER');
    const clientA = await connect(tokenA);
    expect(clientA.connected).toBe(true);

    const joinPromise = new Promise<any>((resolve) => {
      clientA.on('room_joined', (data) => resolve({ status: 'JOINED', data }));
      clientA.on('room_error', (err) => resolve({ status: 'ERROR', err }));
    });

    clientA.emit('join_room', { room: 'fleet:monitoring' });
    const result = await joinPromise;

    expect(result.status).toBe('ERROR');
    expect(result.err.code).toBe('ROOM_ACCESS_DENIED');

    clientA.disconnect();
  });

  it('should ALLOW Owner to join fleet:monitoring and any delivery room', async () => {
    const tokenOwner = createToken(ownerUser, ownerDevice, ownerSession, 'OWNER');
    const clientOwner = await connect(tokenOwner);
    expect(clientOwner.connected).toBe(true);

    const fleetPromise = new Promise<any>((resolve) => {
      clientOwner.on('room_joined', (data) => resolve({ status: 'JOINED', data }));
    });
    clientOwner.emit('join_room', { room: 'fleet:monitoring' });
    const fleetRes = await fleetPromise;
    expect(fleetRes.status).toBe('JOINED');

    clientOwner.disconnect();
  });

  it('should ALLOW conversation participants (Owner & Driver A) and REJECT non-participant (Driver B)', async () => {
    const tokenA = createToken(driverUserA, driverDeviceA, driverSessionA, 'DRIVER');
    const tokenB = createToken(driverUserB, driverDeviceB, driverSessionB, 'DRIVER');

    const clientA = await connect(tokenA);
    const clientB = await connect(tokenB);

    // Driver A joins conversation A
    const joinAPromise = new Promise<any>((resolve) => {
      clientA.on('room_joined', (data) => resolve({ status: 'JOINED', data }));
      clientA.on('room_error', (err) => resolve({ status: 'ERROR', err }));
    });
    clientA.emit('join_room', { room: `conversation:${conversationA.id}` });
    const resA = await joinAPromise;
    expect(resA.status).toBe('JOINED');

    // Driver B attempts to join conversation A
    const joinBPromise = new Promise<any>((resolve) => {
      clientB.on('room_joined', (data) => resolve({ status: 'JOINED', data }));
      clientB.on('room_error', (err) => resolve({ status: 'ERROR', err }));
    });
    clientB.emit('join_room', { room: `conversation:${conversationA.id}` });
    const resB = await joinBPromise;
    expect(resB.status).toBe('ERROR');
    expect(resB.err.code).toBe('ROOM_ACCESS_DENIED');

    clientA.disconnect();
    clientB.disconnect();
  });

  it('should safely reject malformed room strings and non-existent resource rooms', async () => {
    const tokenA = createToken(driverUserA, driverDeviceA, driverSessionA, 'DRIVER');
    const clientA = await connect(tokenA);

    const nonExistentPromise = new Promise<any>((resolve) => {
      clientA.on('room_error', (err) => resolve(err));
    });
    clientA.emit('join_room', { room: `delivery:${uuidv4()}` });
    const nonExistErr = await nonExistentPromise;
    expect(nonExistErr.code).toBe('DELIVERY_NOT_FOUND');

    const malformedPromise = new Promise<any>((resolve) => {
      clientA.on('room_error', (err) => resolve(err));
    });
    clientA.emit('join_room', { room: 'invalid-room-format' });
    const malformedErr = await malformedPromise;
    expect(malformedErr.code).toBe('UNKNOWN_ROOM_PATTERN');

    clientA.disconnect();
  });
});

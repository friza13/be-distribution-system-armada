import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RedisService } from '../../src/common/redis/redis.service';
import { hashPassword } from '../../src/common/utils/password.util';
import { TrackingCacheService } from '../../src/modules/tracking/services/tracking-cache.service';
import { RealtimeEventEnvelope } from '../../src/modules/realtime/dto/realtime-envelope.dto';

describe('Redis Telemetry Cache & Realtime Live Map Streaming (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let trackingCacheService: TrackingCacheService;
  let serverPort: number;

  let driverUserA: any;
  let driverEntityA: any;
  let driverDeviceA: any;
  let driverSessionA: any;
  let driverTokenA: string;

  let ownerUser: any;
  let ownerDevice: any;
  let ownerSession: any;
  let ownerToken: string;

  let deliveryA: any;

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
    trackingCacheService = app.get(TrackingCacheService);

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

    // Owner Setup
    ownerUser = await prisma.user.create({
      data: {
        username: `ws_stream_own_${Date.now()}`,
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

    // Driver A Setup
    driverUserA = await prisma.user.create({
      data: {
        username: `ws_stream_drv_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-STRM-${Date.now()}`, displayName: 'Stream Driver', phone: driverUserA.phone },
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

    // Delivery A
    deliveryA = await prisma.delivery.create({
      data: { deliveryCode: `DEL-STRM-${Date.now()}`, driverId: driverEntityA.id, createdBy: ownerUser.id, status: 'ASSIGNED' },
    });
  });

  afterAll(async () => {
    if (deliveryA) await prisma.delivery.deleteMany({ where: { id: deliveryA.id } });
    if (driverUserA) {
      await prisma.$executeRaw`DELETE FROM location_points WHERE driver_id = ${driverEntityA.id}::uuid`;
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

  beforeEach(async () => {
    if (driverEntityA) {
      await redis.resetRateLimit(`driver:location:latest:${driverEntityA.id}`);
      await redis.resetRateLimit(`throttle:location:driver:${driverEntityA.id}`);
    }
  });

  function connect(token: string): Promise<Socket> {
    const wsUrl = `http://localhost:${serverPort}/v1/realtime`;
    const socket = io(wsUrl, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token: `Bearer ${token}` } });
    return new Promise((resolve) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', () => resolve(socket));
    });
  }

  it('should update Redis latest-location cache when valid GPS is ingested', async () => {
    const recordedAt = new Date().toISOString();

    const result = await trackingCacheService.setLatestLocation(driverEntityA.id, {
      driverId: driverEntityA.id,
      deliveryId: deliveryA.id,
      latitude: -6.20012,
      longitude: 106.8162,
      accuracyM: 8.5,
      recordedAt,
      receivedAt: new Date().toISOString(),
    });

    expect(result).toBe(true);

    const cached = await trackingCacheService.getLatestLocation(driverEntityA.id);
    expect(cached).toBeDefined();
    expect(cached?.latitude).toBe(-6.20012);
    expect(cached?.driverId).toBe(driverEntityA.id);
  });

  it('should NOT overwrite Redis cache if incoming GPS point is out-of-order (recordedAt older)', async () => {
    const newerTime = new Date('2026-09-02T10:10:00.000Z').toISOString();
    const olderTime = new Date('2026-09-02T10:05:00.000Z').toISOString();

    // 1. Set newer location first
    await trackingCacheService.setLatestLocation(driverEntityA.id, {
      driverId: driverEntityA.id,
      latitude: -6.2000,
      longitude: 106.8000,
      accuracyM: 10,
      recordedAt: newerTime,
      receivedAt: new Date().toISOString(),
    });

    // 2. Attempt to overwrite with older location
    const updateResult = await trackingCacheService.setLatestLocation(driverEntityA.id, {
      driverId: driverEntityA.id,
      latitude: -6.3000, // Should NOT overwrite
      longitude: 106.9000,
      accuracyM: 10,
      recordedAt: olderTime,
      receivedAt: new Date().toISOString(),
    });

    expect(updateResult).toBe(false);

    // 3. Verify Redis cache still holds newer latitude -6.2000
    const cached = await trackingCacheService.getLatestLocation(driverEntityA.id);
    expect(cached?.latitude).toBe(-6.2000);
    expect(cached?.recordedAt).toBe(newerTime);
  });

  it('should broadcast driver.location.updated via WebSocket when Driver submits via WS event', async () => {
    const ownerClient = await connect(ownerToken);
    const driverClient = await connect(driverTokenA);

    expect(ownerClient.connected).toBe(true);
    expect(driverClient.connected).toBe(true);

    // Owner joins fleet:monitoring room
    const joinPromise = new Promise<any>((resolve) => {
      ownerClient.on('room_joined', (data) => resolve(data));
    });
    ownerClient.emit('join_room', { room: 'fleet:monitoring' });
    await joinPromise;

    // Set listener for location update on Owner client
    const locationUpdatePromise = new Promise<RealtimeEventEnvelope>((resolve) => {
      ownerClient.on('driver.location.updated', (event: RealtimeEventEnvelope) => {
        resolve(event);
      });
    });

    // Driver emits driver.location.update via WebSocket
    const recordedAt = new Date().toISOString();
    driverClient.emit('driver.location.update', {
      latitude: -6.2050,
      longitude: 106.8150,
      accuracyM: 10.0,
      recordedAt,
      deliveryId: deliveryA.id,
    });

    // Verify Owner receives live map broadcast
    const event = await locationUpdatePromise;
    expect(event).toBeDefined();
    expect(event.event).toBe('driver.location.updated');
    expect(event.version).toBe(1);
    expect(event.actor.driverId).toBe(driverEntityA.id);
    expect((event.payload as any).latitude).toBe(-6.2050);

    ownerClient.disconnect();
    driverClient.disconnect();
  });

  it('should REJECT Owner attempting to submit telemetry via WS driver.location.update', async () => {
    const ownerClient = await connect(ownerToken);

    const errorPromise = new Promise<any>((resolve) => {
      ownerClient.on('location_error', (err) => resolve(err));
    });

    ownerClient.emit('driver.location.update', {
      latitude: -6.2000,
      longitude: 106.8000,
      accuracyM: 10,
      recordedAt: new Date().toISOString(),
    });

    const err = await errorPromise;
    expect(err.code).toBe('FORBIDDEN');

    ownerClient.disconnect();
  });
});

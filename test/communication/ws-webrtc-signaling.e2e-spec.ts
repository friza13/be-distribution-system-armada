import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';
import { RealtimeEventEnvelope } from '../../src/modules/realtime/dto/realtime-envelope.dto';

describe('WebRTC Realtime Signaling Gateway & Consent Gate (E2E)', () => {
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

  const secretKey = 'test_secret_with_minimum_32_characters_length_here';
  const issuer = 'dms-api';
  const audience = 'dms-clients';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
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
        username: `wssig_own_${Date.now()}`,
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
        username: `wssig_drv_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-WSS-${Date.now()}`, displayName: 'WS Signal Driver', phone: driverUserA.phone },
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
  });

  afterAll(async () => {
    await prisma.realtimeSession.deleteMany({ where: { ownerId: ownerUser.id } });
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

  it('should exchange WebRTC offer, answer, and ICE candidate signals over WebSocket after driver accepts call', async () => {
    const ownerClient = await connect(ownerToken);
    const driverClient = await connect(driverTokenA);

    expect(ownerClient.connected).toBe(true);
    expect(driverClient.connected).toBe(true);

    // 1. Owner initiates voice call session via REST
    const initRes = await request(app.getHttpServer())
      .post('/v1/voice-sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ driverId: driverEntityA.id, type: 'VOICE_PTT' })
      .expect(HttpStatus.CREATED);

    const callSessionId = initRes.body.data.sessionId;

    // 2. Both clients join room session:<callSessionId> for WebRTC signaling
    const joinOwner = new Promise<any>((resolve) => ownerClient.on('room_joined', (d) => resolve(d)));
    const joinDriver = new Promise<any>((resolve) => driverClient.on('room_joined', (d) => resolve(d)));

    ownerClient.emit('join_room', { room: `session:${callSessionId}` });
    driverClient.emit('join_room', { room: `session:${callSessionId}` });

    await Promise.all([joinOwner, joinDriver]);

    // Driver responds ACCEPT via WebSocket
    driverClient.emit('webrtc.call.respond', {
      sessionId: callSessionId,
      action: 'ACCEPT',
    });

    await new Promise((r) => setTimeout(r, 50));

    // 3. Driver receives offer relayed by Owner
    const offerPromise = new Promise<RealtimeEventEnvelope>((resolve) => {
      driverClient.on('webrtc.signal.offer', (event: RealtimeEventEnvelope) => {
        resolve(event);
      });
    });

    ownerClient.emit('webrtc.signal.offer', {
      sessionId: callSessionId,
      sdp: 'v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv',
    });

    const offerEvent = await offerPromise;
    expect(offerEvent).toBeDefined();
    expect(offerEvent.event).toBe('webrtc.signal.offer');
    expect((offerEvent.payload as any).sdp).toContain('v=0');

    // 4. Owner receives answer relayed by Driver
    const answerPromise = new Promise<RealtimeEventEnvelope>((resolve) => {
      ownerClient.on('webrtc.signal.answer', (event: RealtimeEventEnvelope) => {
        resolve(event);
      });
    });

    driverClient.emit('webrtc.signal.answer', {
      sessionId: callSessionId,
      sdp: 'v=0\r\no=- 9876543210 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=recvonly',
    });

    const answerEvent = await answerPromise;
    expect(answerEvent).toBeDefined();
    expect(answerEvent.event).toBe('webrtc.signal.answer');

    // 5. Exchange ICE Candidate
    const icePromise = new Promise<RealtimeEventEnvelope>((resolve) => {
      driverClient.on('webrtc.signal.ice_candidate', (event: RealtimeEventEnvelope) => {
        resolve(event);
      });
    });

    ownerClient.emit('webrtc.signal.ice_candidate', {
      sessionId: callSessionId,
      candidate: { candidate: 'candidate:1 1 UDP 2013266431 127.0.0.1 54321 typ host', sdpMid: 'audio' },
    });

    const iceEvent = await icePromise;
    expect(iceEvent).toBeDefined();
    expect(iceEvent.event).toBe('webrtc.signal.ice_candidate');

    ownerClient.disconnect();
    driverClient.disconnect();
  });
});

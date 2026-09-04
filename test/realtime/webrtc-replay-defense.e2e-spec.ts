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

describe('WebRTC Signaling Nonce & Sequence Replay Defense (E2E)', () => {
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
        username: `webrtc_replay_own_${Date.now()}`,
        phone: `+62818${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });
    ownerDevice = await prisma.device.create({
      data: { userId: ownerUser.id, deviceIdentifier: `own-rep-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
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
        username: `webrtc_replay_drv_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: { userId: driverUserA.id, employeeCode: `DRV-REP-${Date.now()}`, displayName: 'WS Replay Driver', phone: driverUserA.phone },
    });
    driverDeviceA = await prisma.device.create({
      data: { userId: driverUserA.id, deviceIdentifier: `drva-rep-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
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

  it('should detect duplicate nonce replay and out-of-order sequence attacks', async () => {
    const ownerClient = await connect(ownerToken);
    const driverClient = await connect(driverTokenA);

    const initRes = await request(app.getHttpServer())
      .post('/v1/voice-sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ driverId: driverEntityA.id, type: 'VOICE_PTT' })
      .expect(HttpStatus.CREATED);

    const callSessionId = initRes.body.data.sessionId;

    const joinOwner = new Promise<any>((resolve) => ownerClient.on('room_joined', (d) => resolve(d)));
    const joinDriver = new Promise<any>((resolve) => driverClient.on('room_joined', (d) => resolve(d)));

    ownerClient.emit('join_room', { room: `session:${callSessionId}` });
    driverClient.emit('join_room', { room: `session:${callSessionId}` });

    await Promise.all([joinOwner, joinDriver]);

    driverClient.emit('webrtc.call.respond', {
      sessionId: callSessionId,
      action: 'ACCEPT',
    });
    await new Promise((r) => setTimeout(r, 50));

    // 1. Send legitimate offer with nonce and seq = 1
    const fixedNonce = uuidv4();
    ownerClient.emit('webrtc.signal.offer', {
      sessionId: callSessionId,
      sdp: 'v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv',
      nonce: fixedNonce,
      seq: 1,
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 50));

    // 2. Replay the exact same payload with identical nonce -> REPLAY_DETECTED
    const replayErrorPromise = new Promise<any>((resolve) => {
      ownerClient.once('call_error', (err) => resolve(err));
    });

    ownerClient.emit('webrtc.signal.offer', {
      sessionId: callSessionId,
      sdp: 'v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv',
      nonce: fixedNonce,
      seq: 2,
      timestamp: Date.now(),
    });

    const replayErr = await replayErrorPromise;
    expect(replayErr).toBeDefined();
    expect(replayErr.code).toBe('REPLAY_DETECTED');

    // 3. Send payload with lower or equal sequence -> OUT_OF_ORDER_SEQUENCE
    const seqErrorPromise = new Promise<any>((resolve) => {
      ownerClient.once('call_error', (err) => resolve(err));
    });

    ownerClient.emit('webrtc.signal.offer', {
      sessionId: callSessionId,
      sdp: 'v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv',
      nonce: uuidv4(),
      seq: 1, // <= last seq 1
      timestamp: Date.now(),
    });

    const seqErr = await seqErrorPromise;
    expect(seqErr).toBeDefined();
    expect(seqErr.code).toBe('OUT_OF_ORDER_SEQUENCE');

    // 4. Send payload with skewed timestamp (>30s) -> CLOCK_SKEW_EXCEEDED
    const skewErrorPromise = new Promise<any>((resolve) => {
      ownerClient.once('call_error', (err) => resolve(err));
    });

    ownerClient.emit('webrtc.signal.offer', {
      sessionId: callSessionId,
      sdp: 'v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv',
      nonce: uuidv4(),
      seq: 5,
      timestamp: Date.now() - 40000,
    });

    const skewErr = await skewErrorPromise;
    expect(skewErr).toBeDefined();
    expect(skewErr.code).toBe('CLOCK_SKEW_EXCEEDED');

    ownerClient.disconnect();
    driverClient.disconnect();
  });
});

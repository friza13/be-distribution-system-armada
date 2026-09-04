import { ConflictException, ForbiddenException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AuthService } from '../../src/modules/auth/auth.service';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { SessionService } from '../../src/modules/sessions/session.service';
import { CallSessionService } from '../../src/modules/communication/services/call-session.service';
import { DeliveryStopsService } from '../../src/modules/deliveries/services/delivery-stops.service';
import { DeliveriesService } from '../../src/modules/deliveries/services/deliveries.service';
import { PodService } from '../../src/modules/pod/services/pod.service';
import { RoutesDomainService } from '../../src/modules/routes/services/routes-domain.service';
import { WsRoomAuthorizerService } from '../../src/modules/realtime/services/ws-room-authorizer.service';
import { WsJwtAuthGuard } from '../../src/modules/realtime/guards/ws-jwt-auth.guard';
import { RealtimeGateway } from '../../src/modules/realtime/gateways/realtime.gateway';
import { RedisService } from '../../src/common/redis/redis.service';
import { WsConnectionManagerService } from '../../src/modules/realtime/services/ws-connection-manager.service';

describe('approved security and logic fixes', () => {
  it('creates a pending non-privileged account regardless of the requested role', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          username: 'new-user',
          createdAt: new Date(),
          role: { code: 'DRIVER' },
        }),
      },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'driver-role', code: 'DRIVER' }) },
    };
    const service = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );

    await service.registerUser({
      username: 'new-user',
      phone: '+628123456789',
      password: 'Password123!',
      roleCode: 'SUPER_ADMIN',
    } as any);

    expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { code: 'DRIVER' } });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ roleId: 'driver-role', status: 'PENDING_ACTIVATION' }),
      include: { role: true },
    });
  });

  it('uses the database session state when Redis revocation is unavailable', async () => {
    const prisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-1',
          deviceId: 'device-1',
          isRevoked: true,
          expiresAt: new Date(Date.now() + 60_000),
          device: { userId: 'user-1', status: 'ACTIVE' },
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', role: { code: 'DRIVER', rolePermissions: [] }, driver: null, id: 'user-1', username: 'user' }) },
    };
    const redis = { isRevoked: jest.fn().mockResolvedValue(null) };
    const strategy = new JwtStrategy(
      { get: jest.fn((key: string, fallback: string) => fallback) } as any,
      prisma as any,
      redis as any,
    );

    await expect(
      strategy.validate({
        sub: 'user-1',
        role: 'DRIVER',
        deviceId: 'device-1',
        sessionId: 'session-1',
        type: 'ACCESS_TOKEN',
      } as any),
    ).rejects.toMatchObject({ response: { code: 'TOKEN_REVOKED' } });
  });

  it('does not create a second refresh successor after an atomic claim loses a race', async () => {
    const existingSession = {
      id: 'session-1',
      userId: 'user-1',
      deviceId: 'device-1',
      tokenFamily: 'family-1',
      isRevoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      user: { role: { code: 'DRIVER' } },
    };
    const tx = {
      session: {
        findFirst: jest.fn().mockResolvedValue(existingSession),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: any) => Promise<unknown>) => callback(tx)),
      session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn() },
    };
    const service = new SessionService(
      prisma as any,
      { setRevocation: jest.fn(), publish: jest.fn() } as any,
    );

    await expect(service.rotateSession('refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', isRevoked: false },
      data: expect.objectContaining({ isRevoked: true }),
    });
    expect(tx.session.create).not.toHaveBeenCalled();
  });

  it('requires call participants for REST response and active participant sessions for signaling', async () => {
    const prisma = {
      realtimeSession: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'call-1', ownerId: 'owner-1', driverId: 'driver-1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) })
          .mockResolvedValueOnce({ id: 'call-1', ownerId: 'owner-1', driverId: 'driver-1', status: 'ENDED', expiresAt: new Date(Date.now() + 60_000) }),
      },
    };
    const service = new CallSessionService(
      prisma as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.respondToCallSession('call-1', 'ACCEPT', { userId: 'other-user', role: 'OWNER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((service as any).authorizeSignal).toBeDefined();
  });

  it('rejects all stop and POD mutations for a cancelled delivery', async () => {
    const cancelledStop = {
      id: 'stop-1',
      deliveryId: 'delivery-1',
      status: 'ARRIVED',
      delivery: { id: 'delivery-1', driverId: 'driver-1', status: 'CANCELLED' },
    };
    const prisma = {
      deliveryStop: { findUnique: jest.fn().mockResolvedValue(cancelledStop), update: jest.fn() },
    };
    const deliveries = { completeDeliveryIfEligible: jest.fn() };
    const stops = new DeliveryStopsService(prisma as any, deliveries as any);
    await expect(stops.startUnloading('stop-1', 'driver-1', 'user-1')).rejects.toMatchObject({
      response: { code: 'INVALID_DELIVERY_STATE' },
    });
    expect(prisma.deliveryStop.update).not.toHaveBeenCalled();

    const pod = new PodService(
      prisma as any,
      {} as any,
      { getStopAndVerifyDriver: jest.fn().mockResolvedValue(cancelledStop) } as any,
      deliveries as any,
    );
    await expect(
      pod.submitPod('stop-1', { receiverName: 'Receiver' } as any, {
        userId: 'user-1',
        role: 'DRIVER',
        driverId: 'driver-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_DELIVERY_STATE' } });
  });

  it('scopes owner skip-stop mutations to deliveries they created', async () => {
    const prisma = {
      deliveryStop: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'stop-1',
          status: 'PENDING',
          delivery: { id: 'delivery-1', createdBy: 'owner-2', driverId: null, status: 'EN_ROUTE' },
        }),
        updateMany: jest.fn(),
      },
    };
    const service = new DeliveryStopsService(prisma as any, { completeDeliveryIfEligible: jest.fn() } as any);

    await expect(service.skipStop('stop-1', {} as any, {
      userId: 'owner-1',
      role: 'OWNER',
      driverId: null,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.deliveryStop.updateMany).not.toHaveBeenCalled();
  });

  it('returns the original POD on retry after auto-completion but rejects new terminal-delivery PODs', async () => {
    const completedStop = {
      id: 'stop-1',
      deliveryId: 'delivery-1',
      status: 'DELIVERED',
      completedAt: new Date(),
      delivery: { id: 'delivery-1', driverId: 'driver-1', status: 'COMPLETED' },
    };
    const terminalUnsubmittedStop = {
      ...completedStop,
      status: 'ARRIVED',
      completedAt: null,
    };
    const prisma = {
      idempotencyRecord: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ responseBody: { podId: 'pod-1', deliveryStopId: 'stop-1', status: 'DELIVERED' } })
          .mockResolvedValueOnce(null),
      },
      proofOfDelivery: { findUnique: jest.fn().mockResolvedValue({ id: 'pod-1', completedAt: completedStop.completedAt }) },
    };
    const getStopAndVerifyDriver = jest.fn()
      .mockResolvedValueOnce(completedStop)
      .mockResolvedValueOnce(terminalUnsubmittedStop);
    const service = new PodService(
      prisma as any,
      {} as any,
      { getStopAndVerifyDriver } as any,
      { completeDeliveryIfEligible: jest.fn() } as any,
    );

    await expect(service.submitPod('stop-1', { receiverName: 'Receiver', idempotencyKey: 'retry-key' } as any, {
      userId: 'driver-user', role: 'DRIVER', driverId: 'driver-1',
    })).resolves.toMatchObject({ idempotent: true, podId: 'pod-1' });

    await expect(service.submitPod('stop-1', { receiverName: 'New receiver', idempotencyKey: 'new-key' } as any, {
      userId: 'driver-user', role: 'DRIVER', driverId: 'driver-1',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('preserves the original JWT expiry and rejects sensitive socket revalidation after it expires', async () => {
    const secret = 'test_secret_with_minimum_32_characters_length_here';
    const config = {
      get: jest.fn((key: string, fallback: string) => {
        if (key === 'jwt.secretOrKey') return secret;
        if (key === 'jwt.issuer') return 'dms-api';
        if (key === 'jwt.audience') return 'dms-clients';
        return fallback;
      }),
    };
    const prisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-1',
          deviceId: 'device-1',
          isRevoked: false,
          expiresAt: new Date(Date.now() + 60_000),
          device: { userId: 'user-1', status: 'ACTIVE' },
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          username: 'user',
          status: 'ACTIVE',
          role: { code: 'DRIVER', rolePermissions: [] },
          driver: null,
        }),
      },
    };
    const redis = { isRevoked: jest.fn().mockResolvedValue(false) };
    const guard = new WsJwtAuthGuard(config as any, prisma as any, redis as any);
    const token = jwt.sign(
      {
        sub: 'user-1',
        role: 'DRIVER',
        deviceId: 'device-1',
        sessionId: 'session-1',
        type: 'ACCESS_TOKEN',
      },
      secret,
      { algorithm: 'HS256', expiresIn: '1h', issuer: 'dms-api', audience: 'dms-clients' },
    );
    const socket = { handshake: { auth: { token } }, data: {} } as any;

    const socketData = await guard.validateHandshake(socket);

    expect((socketData as any).accessTokenExp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    (socketData as any).accessTokenExp = Math.floor(Date.now() / 1000) - 1;
    await expect(guard.validateSocket(socket)).rejects.toThrow('UNAUTHORIZED: Access token expired');
  });

  it('replays the original POD response for concurrent retries whose idempotency claim wins first', async () => {
    const stop = {
      id: 'stop-1',
      deliveryId: 'delivery-1',
      status: 'ARRIVED',
      completedAt: null,
      delivery: { id: 'delivery-1', driverId: 'driver-1', status: 'EN_ROUTE' },
    };
    const actor = { userId: 'driver-user', role: 'DRIVER', driverId: 'driver-1' };
    const idempotencyKey = '00000000-0000-4000-8000-000000000003';
    let stopStatus = 'ARRIVED';
    let record: any = null;
    let releaseSecondConflict!: () => void;
    const secondConflict = new Promise<void>((resolve) => { releaseSecondConflict = resolve; });
    let transactionTail = Promise.resolve();

    const tx = {
      idempotencyRecord: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          if (record) throw { code: 'P2002' };
          record = { responseBody: data.responseBody };
        }),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          record.responseBody = data.responseBody;
        }),
      },
      deliveryStop: {
        updateMany: jest.fn().mockImplementation(async () => {
          if (stopStatus !== 'ARRIVED') {
            releaseSecondConflict();
            return { count: 0 };
          }
          stopStatus = 'DELIVERED';
          return { count: 1 };
        }),
      },
      proofOfDelivery: {
        create: jest.fn().mockResolvedValue({
          id: 'pod-1',
          completedAt: new Date('2026-09-04T00:00:00.000Z'),
        }),
      },
      deliveryEvent: { create: jest.fn() },
    };
    const prisma = {
      idempotencyRecord: {
        findUnique: jest.fn().mockImplementation(async () => record),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          await secondConflict;
          record = { responseBody: data.responseBody };
        }),
      },
      $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => {
        const previous = transactionTail;
        let release!: () => void;
        transactionTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
          return await callback(tx);
        } finally {
          release();
        }
      }),
    };
    const service = new PodService(
      prisma as any,
      {} as any,
      { getStopAndVerifyDriver: jest.fn().mockResolvedValue(stop) } as any,
      { completeDeliveryIfEligible: jest.fn() } as any,
    );

    const results: any[] = await Promise.all([
      service.submitPod('stop-1', { receiverName: 'Receiver', idempotencyKey } as any, actor),
      service.submitPod('stop-1', { receiverName: 'Receiver', idempotencyKey } as any, actor),
    ]);

    expect(results.map((result) => result.podId)).toEqual(['pod-1', 'pod-1']);
    expect(results.filter((result) => result.idempotent)).toHaveLength(1);
    expect(tx.proofOfDelivery.create).toHaveBeenCalledTimes(1);
  });

  it('extends the WebRTC session lifetime when an invite is accepted', async () => {
    const pendingExpiresAt = new Date(Date.now() + 30_000);
    const prisma = {
      realtimeSession: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'call-1', ownerId: 'owner-1', driverId: 'driver-1', status: 'PENDING', expiresAt: pendingExpiresAt })
          .mockResolvedValueOnce({ id: 'call-1', ownerId: 'owner-1', driverId: 'driver-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3_600_000) }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new CallSessionService(prisma as any, {} as any, {} as any);

    await service.respondToCallSession('call-1', 'ACCEPT', {
      userId: 'driver-user', role: 'DRIVER', driverId: 'driver-1',
    });

    const update = prisma.realtimeSession.updateMany.mock.calls[0][0];
    expect(update.data.expiresAt).toBeInstanceOf(Date);
    expect(update.data.expiresAt.getTime()).toBeGreaterThan(pendingExpiresAt.getTime());
  });

  it('rejects incomplete, duplicate, and non-contiguous route stop sets', async () => {
    const delivery = {
      id: 'delivery-1',
      createdBy: 'owner-1',
      driverId: null,
      stops: [{ id: 'stop-1' }, { id: 'stop-2' }, { id: 'stop-3' }],
    };
    const prisma = {
      delivery: { findUnique: jest.fn().mockResolvedValue(delivery) },
      idempotencyRecord: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new RoutesDomainService(
      prisma as any,
      { incrRateLimit: jest.fn().mockResolvedValue(1) } as any,
      {} as any,
      {} as any,
    );
    const actor = { userId: 'owner-1', role: 'OWNER', driverId: null };

    for (const recommendedSequence of [['stop-1'], ['stop-1', 'stop-1'], []]) {
      await expect(service.selectRoute('delivery-1', {
        source: 'MANUAL',
        recommendedSequence,
        totalDistanceMeters: 1,
        estimatedDurationSeconds: 1,
      } as any, actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
    }

    await expect(service.reorderStops('delivery-1', {
      stopSequence: [
        { deliveryStopId: 'stop-1', sequence: 1 },
        { deliveryStopId: 'stop-2', sequence: 3 },
        { deliveryStopId: 'stop-3', sequence: 3 },
      ],
    } as any, actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });


  it('does not relay WebRTC signaling from a socket that has not joined the call room', async () => {
    const server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
    const callSessionService = { authorizeSignal: jest.fn() };
    const gateway = new RealtimeGateway(
      { validateSocket: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn((key: string, fallback: number) => fallback) } as any,
      {} as any,
      {} as any,
      callSessionService as any,
    );
    gateway.server = server as any;
    const client = {
      emit: jest.fn(),
      rooms: new Set(['socket-1']),
      data: {
        userId: 'owner-1',
        role: 'OWNER',
        driverId: null,
        deviceId: 'device-1',
        joinedRooms: new Set<string>(),
      },
    } as any;

    await gateway.handleWebrtcSignalOffer(client, { sessionId: 'call-1', sdp: 'offer' });

    expect(callSessionService.authorizeSignal).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('call_error', expect.objectContaining({ code: 'SIGNALING_FAILED' }));
    expect(server.to).not.toHaveBeenCalled();
  });

  it('disconnects and rejects sensitive WebSocket operations after session revocation', async () => {
    const server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
    const client = {
      id: 'socket-1',
      connected: true,
      emit: jest.fn(),
      disconnect: jest.fn(),
      rooms: new Set(['socket-1', 'session:call-1']),
      data: {
        userId: 'owner-1', role: 'OWNER', driverId: null, deviceId: 'device-1', sessionId: 'session-1',
        joinedRooms: new Set(['session:call-1']),
      },
    } as any;
    const connectionManager = { removeSocket: jest.fn() };
    const callSessionService = { authorizeSignal: jest.fn() };
    const gateway = new RealtimeGateway(
      { validateSocket: jest.fn().mockRejectedValue(new Error('SESSION_REVOKED')) } as any,
      connectionManager as any,
      {} as any,
      {} as any,
      { get: jest.fn((key: string, fallback: number) => fallback) } as any,
      {} as any, {} as any, callSessionService as any,
    );
    gateway.server = server as any;

    await gateway.handleWebrtcSignalOffer(client, { sessionId: 'call-1', sdp: 'offer' });

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(connectionManager.removeSocket).toHaveBeenCalledWith('socket-1');
    expect(callSessionService.authorizeSignal).not.toHaveBeenCalled();
    expect(server.to).not.toHaveBeenCalled();
  });

  it('disconnects every socket registered for a revoked session and device', () => {
    const manager = new WsConnectionManagerService();
    const makeSocket = (id: string) => ({
      id,
      emit: jest.fn(),
      disconnect: jest.fn(),
      data: {
        userId: 'owner-1', role: 'OWNER', sessionId: 'session-1', deviceId: 'device-1', driverId: null,
        joinedRooms: new Set(),
      },
    } as any);
    const first = makeSocket('socket-1');
    const second = makeSocket('socket-2');

    manager.registerSocket(first);
    manager.registerSocket(second);
    manager.disconnectSession('session-1');
    manager.disconnectDevice('device-1');

    expect(first.disconnect).toHaveBeenCalledWith(true);
    expect(second.disconnect).toHaveBeenCalledWith(true);
    expect(manager.getActiveConnectionCount()).toBe(0);
  });

  it('does not let an owner read another owner delivery', async () => {
    const prisma = {
      delivery: { findUnique: jest.fn().mockResolvedValue({ id: 'delivery-1', createdBy: 'owner-2' }) },
    };
    const service = new DeliveriesService(prisma as any);

    await expect(service.getDeliveryById('delivery-1', {
      userId: 'owner-1',
      role: 'OWNER',
    })).rejects.toMatchObject({ response: { code: 'RESOURCE_FORBIDDEN' } });
  });

  it('does not let an owner join another owner delivery room', async () => {
    const prisma = {
      delivery: { findUnique: jest.fn().mockResolvedValue({ id: 'delivery-1', driverId: null, createdBy: 'owner-2' }) },
    };
    const service = new WsRoomAuthorizerService(prisma as any);

    await expect(service.authorizeRoomJoin(
      { userId: 'owner-1', role: 'OWNER', driverId: null } as any,
      'delivery:delivery-1',
    )).resolves.toMatchObject({ authorized: false, reason: 'ROOM_ACCESS_DENIED' });
  });

  it('forces database fallback after a revocation write fails even when Redis reads normally', async () => {
    const redis = new RedisService({ get: jest.fn() } as any);
    const set = jest.fn().mockRejectedValue(new Error('Redis write failed'));
    const exists = jest.fn().mockResolvedValue(0);
    (redis as any).client = { set, exists };
    (redis as any).isConnected = true;

    await redis.setRevocation('revoked:session:session-1');

    await expect(redis.isRevoked('revoked:session:session-1')).resolves.toBeNull();
    expect(exists).not.toHaveBeenCalled();
  });

  it('bounds and prunes uncertain revocation keys', async () => {
    const redis = new RedisService({ get: jest.fn() } as any);
    const markUncertain = (redis as any).markRevocationUncertain.bind(redis);

    for (let index = 0; index < 10_001; index += 1) {
      markUncertain(`revoked:session:${index}`);
    }

    expect((redis as any).uncertainRevocationKeys.size).toBeLessThanOrEqual(10_000);

    (redis as any).uncertainRevocationKeys.set('expired-key', Date.now() - 1);
    (redis as any).client = { exists: jest.fn().mockResolvedValue(0) };
    (redis as any).isConnected = true;
    await expect(redis.isRevoked('expired-key')).resolves.toBe(false);
    expect((redis as any).uncertainRevocationKeys.has('expired-key')).toBe(false);
  });

  it('allows only one concurrent delivery terminal transition to win', async () => {
    let status = 'EN_ROUTE';
    let transactionTail = Promise.resolve();
    const delivery = {
      id: 'delivery-1',
      status,
      createdBy: 'owner-1',
      driverId: 'driver-1',
      stops: [],
    };
    const tx = {
      deliveryStop: { findMany: jest.fn().mockResolvedValue([{ status: 'DELIVERED' }]) },
      delivery: {
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const canComplete = where.status === 'EN_ROUTE' && status === 'EN_ROUTE';
          const canCancel = where.status?.notIn && status === 'EN_ROUTE';
          if (!canComplete && !canCancel) return { count: 0 };
          status = data.status;
          return { count: 1 };
        }),
        findUnique: jest.fn().mockImplementation(async () => ({ ...delivery, status })),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      delivery: {
        findUnique: jest.fn().mockImplementation(async () => ({ ...delivery, status })),
      },
      $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => {
        const previous = transactionTail;
        let release!: () => void;
        transactionTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
          return await callback(tx);
        } finally {
          release();
        }
      }),
    };
    const service = new DeliveriesService(prisma as any);
    const actor = { userId: 'owner-1', role: 'OWNER' };

    const results = await Promise.allSettled([
      service.completeDelivery('delivery-1', actor),
      service.cancelDelivery('delivery-1', { reason: 'cancelled' } as any, actor),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(['COMPLETED', 'CANCELLED']).toContain(status);
    expect(tx.delivery.updateMany).toHaveBeenCalled();
  });

  it('claims route idempotency inside the route mutation transaction before creating a route', async () => {
    const events: string[] = [];
    const delivery = {
      id: 'delivery-1',
      createdBy: 'owner-1',
      driverId: null,
      stops: [{ id: 'stop-1' }],
    };
    const tx = {
      $executeRaw: jest.fn().mockImplementation(async () => { events.push('lock'); }),
      idempotencyRecord: {
        create: jest.fn().mockImplementation(async () => { events.push('claim'); }),
        update: jest.fn().mockImplementation(async () => { events.push('store-response'); }),
      },
      route: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async () => {
          events.push('route');
          return { id: 'route-1', deliveryId: 'delivery-1', version: 1, source: 'MANUAL', selectedAt: new Date() };
        }),
      },
      routeStop: { createMany: jest.fn() },
      delivery: { update: jest.fn() },
    };
    const prisma = {
      delivery: { findUnique: jest.fn().mockResolvedValue(delivery) },
      idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(tx)),
    };
    const service = new RoutesDomainService(
      prisma as any,
      { incrRateLimit: jest.fn().mockResolvedValue(1) } as any,
      {} as any,
      {} as any,
    );

    await service.selectRoute('delivery-1', {
      source: 'MANUAL',
      recommendedSequence: ['stop-1'],
      totalDistanceMeters: 1,
      estimatedDurationSeconds: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    } as any, { userId: 'owner-1', role: 'OWNER', driverId: null });

    expect(events.indexOf('claim')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('claim')).toBeLessThan(events.indexOf('route'));
  });

  it('rejects an expired WebRTC response and conditionally times out pending sessions', async () => {
    const expiredSession = {
      id: 'call-1',
      ownerId: 'owner-1',
      driverId: 'driver-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1),
    };
    const prisma = {
      realtimeSession: {
        findUnique: jest.fn().mockResolvedValue(expiredSession),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new CallSessionService(prisma as any, {} as any, {} as any);

    await expect(service.respondToCallSession('call-1', 'ACCEPT', {
      userId: 'driver-user',
      role: 'DRIVER',
      driverId: 'driver-1',
    })).rejects.toMatchObject({ response: { code: 'CALL_SESSION_EXPIRED' } });

    await (service as any).handlePendingTimeout('call-1');
    expect(prisma.realtimeSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'PENDING', expiresAt: expect.any(Object) }),
    }));
  });

  it('authorizes signaling from actual Socket.IO room membership', async () => {
    const server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
    const callSessionService = { authorizeSignal: jest.fn().mockResolvedValue({}) };
    const gateway = new RealtimeGateway(
      { validateSocket: jest.fn().mockResolvedValue(undefined) } as any, {} as any, {} as any, {} as any,
      { get: jest.fn((key: string, fallback: number) => fallback) } as any,
      {} as any, {} as any, callSessionService as any,
    );
    gateway.server = server as any;
    const client = {
      emit: jest.fn(),
      rooms: new Set(['socket-1', 'session:call-1']),
      data: {
        userId: 'owner-1', role: 'OWNER', driverId: null, deviceId: 'device-1',
        joinedRooms: new Set<string>(),
      },
    } as any;

    await gateway.handleWebrtcSignalOffer(client, { sessionId: 'call-1', sdp: 'offer' });

    expect(callSessionService.authorizeSignal).toHaveBeenCalled();
    expect(server.to).toHaveBeenCalledWith('session:call-1');
  });


  it('rejects a revoked session even when Redis reports no revocation key', async () => {
    const prisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-1',
          deviceId: 'device-1',
          isRevoked: true,
          expiresAt: new Date(Date.now() + 60_000),
          device: { userId: 'user-1', status: 'ACTIVE' },
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', role: { code: 'DRIVER', rolePermissions: [] }, driver: null, id: 'user-1', username: 'user' }) },
    };
    const strategy = new JwtStrategy(
      { get: jest.fn((key: string, fallback: string) => fallback) } as any,
      prisma as any,
      { isRevoked: jest.fn().mockResolvedValue(false) } as any,
    );

    await expect(strategy.validate({
      sub: 'user-1', role: 'DRIVER', deviceId: 'device-1', sessionId: 'session-1', type: 'ACCESS_TOKEN',
    } as any)).rejects.toMatchObject({ response: { code: 'TOKEN_REVOKED' } });
  });

  it('mutates a route once when concurrent requests claim the same idempotency key', async () => {
    const delivery = {
      id: 'delivery-1',
      createdBy: 'owner-1',
      driverId: null,
      stops: [{ id: 'stop-1' }],
    };
    const idempotencyKey = '00000000-0000-4000-8000-000000000002';
    let record: any = null;
    let routeCount = 0;
    let transactionTail = Promise.resolve();
    const tx = {
      $executeRaw: jest.fn(),
      idempotencyRecord: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          if (record) throw { code: 'P2002' };
          record = { responseBody: data.responseBody };
        }),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          record.responseBody = data.responseBody;
        }),
      },
      route: {
        findFirst: jest.fn().mockImplementation(async () => routeCount ? { version: routeCount } : null),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          routeCount += 1;
          return { id: `route-${routeCount}`, ...data };
        }),
      },
      routeStop: { createMany: jest.fn() },
      delivery: { update: jest.fn() },
    };
    const prisma = {
      delivery: { findUnique: jest.fn().mockResolvedValue(delivery) },
      idempotencyRecord: {
        findUnique: jest.fn().mockImplementation(async () => record),
      },
      $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => {
        const previous = transactionTail;
        let release!: () => void;
        transactionTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
          return await callback(tx);
        } finally {
          release();
        }
      }),
    };
    const service = new RoutesDomainService(
      prisma as any,
      { incrRateLimit: jest.fn().mockResolvedValue(1) } as any,
      {} as any,
      {} as any,
    );
    const request = {
      source: 'MANUAL',
      recommendedSequence: ['stop-1'],
      totalDistanceMeters: 1,
      estimatedDurationSeconds: 1,
      idempotencyKey,
    } as any;
    const actor = { userId: 'owner-1', role: 'OWNER', driverId: null };

    const results = await Promise.all([
      service.selectRoute('delivery-1', request, actor),
      service.selectRoute('delivery-1', request, actor),
    ]);

    expect(routeCount).toBe(1);
    expect(results.filter((result) => result.idempotent)).toHaveLength(1);
    expect(results.map((result) => result.version)).toEqual([1, 1]);
  });

  it('allows either accept or timeout to claim a pending WebRTC session, never both', async () => {
    let status = 'PENDING';
    const responseSession = {
      id: 'call-1', ownerId: 'owner-1', driverId: 'driver-1', status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const timeoutSession = { ...responseSession, expiresAt: new Date(Date.now() - 1) };
    const findUnique = jest.fn()
      .mockResolvedValueOnce(responseSession)
      .mockResolvedValueOnce(timeoutSession)
      .mockImplementation(async () => ({ ...responseSession, status, expiresAt: status === 'TIMEOUT' ? timeoutSession.expiresAt : responseSession.expiresAt }));
    const updateMany = jest.fn().mockImplementation(async ({ where, data }: any) => {
      if (status !== 'PENDING') return { count: 0 };
      status = data.status;
      return { count: 1 };
    });
    const prisma = {
      realtimeSession: { findUnique, updateMany },
      auditLog: { create: jest.fn() },
    };
    const service = new CallSessionService(prisma as any, {} as any, {} as any);

    const results = await Promise.allSettled([
      service.respondToCallSession('call-1', 'ACCEPT', { userId: 'driver-user', role: 'DRIVER', driverId: 'driver-1' }),
      (service as any).handlePendingTimeout('call-1'),
    ]);

    expect(status).toBe('ACTIVE');
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
  });

});

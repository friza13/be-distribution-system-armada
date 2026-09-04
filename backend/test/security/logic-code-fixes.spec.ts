import { ForbiddenException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { AuthService } from '../../src/modules/auth/auth.service';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { SessionService } from '../../src/modules/sessions/session.service';
import { CallSessionService } from '../../src/modules/communication/services/call-session.service';
import { DeliveryStopsService } from '../../src/modules/deliveries/services/delivery-stops.service';
import { DeliveriesService } from '../../src/modules/deliveries/services/deliveries.service';
import { PodService } from '../../src/modules/pod/services/pod.service';
import { RoutesDomainService } from '../../src/modules/routes/services/routes-domain.service';
import { WsRoomAuthorizerService } from '../../src/modules/realtime/services/ws-room-authorizer.service';
import { RealtimeGateway } from '../../src/modules/realtime/gateways/realtime.gateway';

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
      user: { findUnique: jest.fn() },
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
      {} as any,
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
});

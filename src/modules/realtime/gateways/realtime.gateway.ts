import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { WsJwtAuthGuard, AuthenticatedSocketData } from '../guards/ws-jwt-auth.guard';
import { WsConnectionManagerService } from '../services/ws-connection-manager.service';
import { WsRoomAuthorizerService } from '../services/ws-room-authorizer.service';
import { RedisService } from '../../../common/redis/redis.service';
import { TrackingService } from '../../tracking/services/tracking.service';
import { MessagesService } from '../../conversations/messages.service';
import { CallSessionService } from '../../communication/services/call-session.service';
import { formatRealtimeEvent } from '../dto/realtime-envelope.dto';
import { JoinRoomDto, LeaveRoomDto } from '../dto/join-room.dto';
import { LocationIngestionDto } from '../../tracking/dto/location-ingestion.dto';
import { ChatSendWsDto, ChatAckWsDto } from '../../conversations/dto/chat-send-ws.dto';
import {
  WebrtcRespondWsDto,
  WebrtcOfferWsDto,
  WebrtcAnswerWsDto,
  WebrtcIceCandidateWsDto,
  WebrtcHangupWsDto,
} from '../../communication/dto/webrtc-signal-ws.dto';

export interface RevocationEventPayload {
  type: 'USER_REVOKED' | 'DEVICE_REVOKED' | 'SESSION_REVOKED';
  userId?: string;
  deviceId?: string;
  sessionId?: string;
  reason?: string;
  timestamp?: string;
}

export interface ClientPongPayload {
  clientTime?: number;
  pingServerTime?: number;
}

@WebSocketGateway({
  namespace: '/v1/realtime',
  cors: {
    origin: '*',
    credentials: true,
  },
  maxHttpBufferSize: 32768, // 32 KB per frame (ADR-007)
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly heartbeatIntervalMs: number;
  private readonly pongTimeoutMs: number;

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly wsJwtAuthGuard: WsJwtAuthGuard,
    private readonly connectionManager: WsConnectionManagerService,
    private readonly roomAuthorizer: WsRoomAuthorizerService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => TrackingService))
    private readonly trackingService: TrackingService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    @Inject(forwardRef(() => CallSessionService))
    private readonly callSessionService: CallSessionService,
  ) {
    this.heartbeatIntervalMs = this.configService.get<number>(
      'realtime.heartbeatIntervalMs',
      25000,
    );
    this.pongTimeoutMs = this.configService.get<number>(
      'realtime.pongTimeoutMs',
      10000,
    );
  }

  async onModuleInit() {
    // Subscribe to Redis Pub/Sub channel 'security:revocation' for instant socket teardown
    await this.redis.subscribe(
      'security:revocation',
      (channel: string, message: string) => {
        this.handleRevocationMessage(message);
      },
    );
    this.logger.log('Subscribed to security:revocation Redis channel');
  }

  onModuleDestroy() {
    this.logger.log('Realtime Gateway destroying, cleaning up connections');
  }

  private handleRevocationMessage(rawMessage: string): void {
    try {
      if (!rawMessage || typeof rawMessage !== 'string') {
        return;
      }
      const event: RevocationEventPayload = JSON.parse(rawMessage);
      if (!event || !event.type) {
        return;
      }

      this.logger.log(
        `Processing revocation event: type=${event.type}, userId=${event.userId || 'none'}, sessionId=${event.sessionId || 'none'}, deviceId=${event.deviceId || 'none'}, reason=${event.reason || 'REVOKED'}`,
      );

      switch (event.type) {
        case 'SESSION_REVOKED':
          if (event.sessionId) {
            this.connectionManager.disconnectSession(
              event.sessionId,
              event.reason || 'SESSION_REVOKED',
            );
          }
          break;

        case 'DEVICE_REVOKED':
          if (event.deviceId) {
            this.connectionManager.disconnectDevice(
              event.deviceId,
              event.reason || 'DEVICE_REVOKED',
            );
          }
          break;

        case 'USER_REVOKED':
          if (event.userId) {
            this.connectionManager.disconnectUser(
              event.userId,
              event.reason || 'USER_REVOKED',
            );
          }
          break;

        default:
          this.logger.warn(`Unknown revocation event type: ${(event as any).type}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error parsing revocation event JSON: ${message}`);
    }
  }

  afterInit(server: Server) {
    this.logger.log('Realtime Gateway initialized on namespace /v1/realtime');

    // Attach Handshake Authentication Middleware
    server.use(async (socket: Socket, next: (err?: Error) => void) => {
      try {
        await this.wsJwtAuthGuard.validateHandshake(socket);
        next();
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error('UNAUTHORIZED');
        this.logger.warn(`WS Handshake rejected: ${error.message}`);
        next(error);
      }
    });
  }

  handleConnection(client: Socket) {
    if (!client.data || !client.data.userId) {
      client.disconnect(true);
      return;
    }

    this.connectionManager.registerSocket(client);
    this.logger.log(
      `WS client connected: ${client.id} (user: ${client.data.userId}, role: ${client.data.role})`,
    );

    // Emit standard connection acknowledgment event
    const connectedEvent = formatRealtimeEvent(
      'realtime.connected',
      {
        socketId: client.id,
        userId: client.data.userId,
        role: client.data.role,
        connectedAt: client.data.connectedAt,
      },
      {
        userId: client.data.userId,
        role: client.data.role,
        deviceId: client.data.deviceId,
        driverId: client.data.driverId,
      },
    );

    client.emit('connected', connectedEvent);

    // Start server-initiated heartbeat cycle
    this.startHeartbeatCycle(client);
  }

  handleDisconnect(client: Socket) {
    this.stopHeartbeatTimers(client);
    this.connectionManager.removeSocket(client.id);
    this.logger.log(`WS client disconnected: ${client.id}`);
  }

  private async revalidateSensitiveSocket(client: Socket): Promise<boolean> {
    try {
      await this.wsJwtAuthGuard.validateSocket(client);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Sensitive WebSocket operation rejected for ${client.id}: ${message}`);
      client.emit('auth_error', {
        code: 'UNAUTHORIZED',
        message: 'Authentication context is no longer valid',
      });
      this.stopHeartbeatTimers(client);
      client.disconnect(true);
      this.connectionManager.removeSocket(client.id);
      return false;
    }
  }

  private startHeartbeatCycle(socket: Socket) {
    const data = socket.data as AuthenticatedSocketData;
    if (!data) return;

    this.stopHeartbeatTimers(socket);

    // Initial ping upon connection or scheduling
    data.heartbeatIntervalTimer = setInterval(() => {
      this.sendHeartbeatPing(socket);
    }, this.heartbeatIntervalMs);
  }

  public sendHeartbeatPing(socket: Socket): void {
    if (!socket.connected) {
      this.stopHeartbeatTimers(socket);
      return;
    }

    const data = socket.data as AuthenticatedSocketData;
    if (!data) return;

    const pingServerTime = Date.now();
    data.lastPingSentAt = pingServerTime;

    // Clear any prior pending pong timeout timer before arming a new one
    if (data.pongTimeoutTimer) {
      clearTimeout(data.pongTimeoutTimer);
      data.pongTimeoutTimer = undefined;
    }

    // Arm pong timeout watchdog: if client fails to respond within pongTimeoutMs -> STALE_HEARTBEAT_TIMEOUT
    data.pongTimeoutTimer = setTimeout(() => {
      this.handleStaleSocketTimeout(socket);
    }, this.pongTimeoutMs);

    // Emit heartbeat ping to client
    socket.emit('ping', { serverTime: pingServerTime });
  }

  private handleStaleSocketTimeout(socket: Socket): void {
    if (!socket.connected) return;

    const data = socket.data as AuthenticatedSocketData;
    const socketId = socket.id;
    const userId = data?.userId || 'unknown';

    this.logger.warn(
      `Heartbeat timeout on socket ${socketId} (userId: ${userId}). Tearing down stale socket.`,
    );

    // Emit disconnect notice with canonical reason STALE_HEARTBEAT_TIMEOUT
    socket.emit('disconnect_notice', {
      event: 'disconnect_notice',
      reason: 'STALE_HEARTBEAT_TIMEOUT',
      timestamp: new Date().toISOString(),
    });

    this.stopHeartbeatTimers(socket);
    socket.disconnect(true);
    this.connectionManager.removeSocket(socketId);
  }

  private stopHeartbeatTimers(socket: Socket) {
    const data = socket.data as AuthenticatedSocketData;
    if (data) {
      if (data.heartbeatIntervalTimer) {
        clearInterval(data.heartbeatIntervalTimer);
        data.heartbeatIntervalTimer = undefined;
      }
      if (data.pongTimeoutTimer) {
        clearTimeout(data.pongTimeoutTimer);
        data.pongTimeoutTimer = undefined;
      }
    }
  }

  @SubscribeMessage('pong')
  handlePongMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ClientPongPayload,
  ): void {
    const data = client.data as AuthenticatedSocketData;
    if (!data) return;

    const pongReceivedAt = Date.now();
    data.lastPongReceivedAt = pongReceivedAt;

    // Disarm pong timeout watchdog timer
    if (data.pongTimeoutTimer) {
      clearTimeout(data.pongTimeoutTimer);
      data.pongTimeoutTimer = undefined;
    }

    // Measure Round-Trip Latency (RTT)
    const pingSentAt = data.lastPingSentAt || payload?.pingServerTime;
    if (pingSentAt && typeof pingSentAt === 'number') {
      const rtt = Math.max(0, pongReceivedAt - pingSentAt);
      data.rttLatencyMs = rtt;
      this.logger.debug(
        `Received pong from socket ${client.id} (user: ${data.userId}): RTT = ${rtt}ms`,
      );
    }
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinRoomDto,
  ): Promise<void> {
    if (!(await this.revalidateSensitiveSocket(client))) return;
    const data = client.data as AuthenticatedSocketData;
    if (!data || !data.userId) {
      client.emit('room_error', {
        code: 'UNAUTHENTICATED',
        message: 'Authentication context required to join rooms',
      });
      return;
    }

    const room = body?.room;
    if (!room || typeof room !== 'string') {
      client.emit('room_error', {
        code: 'INVALID_ROOM_FORMAT',
        message: 'Valid room string is required',
      });
      return;
    }

    const authResult = await this.roomAuthorizer.authorizeRoomJoin(data, room);

    if (!authResult.authorized) {
      this.logger.warn(
        `Room join denied for socket ${client.id} (userId: ${data.userId}, role: ${data.role}) to room '${room}': ${authResult.reason}`,
      );
      client.emit('room_error', {
        code: authResult.reason || 'ROOM_ACCESS_DENIED',
        room,
        message: 'You are not authorized to subscribe to this channel',
      });
      return;
    }

    const targetRoom = authResult.normalizedRoom || room;
    await client.join(targetRoom);
    data.joinedRooms.add(targetRoom);

    this.logger.log(
      `Socket ${client.id} (userId: ${data.userId}) joined authorized room: ${targetRoom}`,
    );

    const roomJoinedEvent = formatRealtimeEvent(
      'room.joined',
      { room: targetRoom },
      {
        userId: data.userId,
        role: data.role,
        deviceId: data.deviceId,
        driverId: data.driverId,
      },
    );

    client.emit('room_joined', roomJoinedEvent);
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: LeaveRoomDto,
  ): Promise<void> {
    const data = client.data as AuthenticatedSocketData;
    const room = body?.room;
    if (!room || typeof room !== 'string') return;

    await client.leave(room);
    if (data?.joinedRooms) {
      data.joinedRooms.delete(room);
    }

    this.logger.log(`Socket ${client.id} left room: ${room}`);

    const roomLeftEvent = formatRealtimeEvent(
      'room.left',
      { room },
      {
        userId: data?.userId || 'anonymous',
        role: data?.role || 'UNKNOWN',
        deviceId: data?.deviceId,
        driverId: data?.driverId,
      },
    );

    client.emit('room_left', roomLeftEvent);
  }

  @SubscribeMessage('driver.location.update')
  async handleDriverLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: LocationIngestionDto,
  ): Promise<void> {
    if (!(await this.revalidateSensitiveSocket(client))) return;
    const data = client.data as AuthenticatedSocketData;
    if (!data || !data.userId) {
      client.emit('location_error', {
        code: 'UNAUTHENTICATED',
        message: 'Authentication context required',
      });
      return;
    }

    if (data.role !== 'DRIVER' || !data.driverId) {
      client.emit('location_error', {
        code: 'FORBIDDEN',
        message: 'Only drivers are authorized to submit location telemetry',
      });
      return;
    }

    try {
      const result = await this.trackingService.processTelemetry(
        dto,
        data.driverId,
        data.role,
        new Date(),
        '/v1/realtime',
      );

      client.emit('location_accepted', {
        success: true,
        data: result,
      });
    } catch (err: unknown) {
      let code = 'GPS_VALIDATION_FAILED';
      let message = 'Telemetry rejected';
      if (err && typeof err === 'object' && 'getResponse' in err) {
        const resp = (err as any).getResponse();
        code = resp?.code || code;
        message = resp?.message || message;
      }
      client.emit('location_error', {
        code,
        message,
      });
    }
  }

  @SubscribeMessage('chat.message.send')
  async handleChatMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ChatSendWsDto,
  ): Promise<void> {
    if (!(await this.revalidateSensitiveSocket(client))) return;
    const data = client.data as AuthenticatedSocketData;
    if (!data || !data.userId) {
      client.emit('chat_error', { code: 'UNAUTHENTICATED', message: 'Authentication required' });
      return;
    }

    try {
      const result = await this.messagesService.sendMessage(
        dto.conversationId,
        {
          recipientDeviceId: dto.recipientDeviceId,
          protocolVersion: dto.protocolVersion,
          ciphertextBlob: dto.ciphertextBlob,
          headerJson: dto.headerJson,
          idempotencyKey: dto.idempotencyKey,
        },
        {
          userId: data.userId,
          role: data.role,
          driverId: data.driverId,
          deviceId: data.deviceId,
        },
        '/v1/realtime',
      );

      // Emit ACK to sender
      const ackEnvelope = formatRealtimeEvent(
        'chat.message.ack',
        { messageId: result.id, status: 'SENT', createdAt: result.createdAt },
        { userId: data.userId, role: data.role, deviceId: data.deviceId, driverId: data.driverId },
      );
      client.emit('chat.message.ack', ackEnvelope);

      // Relay ciphertext envelope to room conversation:<id>
      if (!result.idempotent) {
        const relayedEnvelope = formatRealtimeEvent(
          'chat.message.relayed',
          {
            messageId: result.id,
            conversationId: result.conversationId,
            senderUserId: result.senderUserId,
            senderDeviceId: result.senderDeviceId,
            recipientDeviceId: result.recipientDeviceId,
            protocolVersion: result.protocolVersion,
            ciphertextBlob: result.ciphertextBlob,
            headerJson: result.headerJson,
            createdAt: result.createdAt,
          },
          { userId: data.userId, role: data.role, deviceId: data.deviceId, driverId: data.driverId },
        );

        this.server.to(`conversation:${dto.conversationId}`).emit('chat.message.relayed', relayedEnvelope);
      }
    } catch (err: unknown) {
      let code = 'CHAT_SEND_FAILED';
      let message = 'Failed to process message';
      if (err && typeof err === 'object' && 'getResponse' in err) {
        const resp = (err as any).getResponse();
        code = resp?.code || code;
        message = resp?.message || message;
      }
      client.emit('chat_error', { code, message });
    }
  }

  @SubscribeMessage('webrtc.call.respond')
  async handleWebrtcCallRespond(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WebrtcRespondWsDto,
  ): Promise<void> {
    if (!(await this.revalidateSensitiveSocket(client))) return;
    const data = client.data as AuthenticatedSocketData;
    if (!data || !data.userId) return;

    try {
      const updated = await this.callSessionService.respondToCallSession(
        dto.sessionId,
        dto.action,
        { userId: data.userId, role: data.role, driverId: data.driverId },
      );

      // Join socket to session room upon acceptance
      if (dto.action === 'ACCEPT') {
        await client.join(`session:${dto.sessionId}`);
        data.joinedRooms.add(`session:${dto.sessionId}`);
      }
    } catch (err: unknown) {
      let code = 'CALL_RESPOND_FAILED';
      let message = 'Failed to process call response';
      if (err && typeof err === 'object' && 'getResponse' in err) {
        const resp = (err as any).getResponse();
        code = resp?.code || code;
        message = resp?.message || message;
      }
      client.emit('call_error', { code, message });
    }
  }

  private async validateWebrtcAntiReplay(
    client: Socket,
    sessionId: string,
    senderId: string,
    nonce: string,
    seq: number,
    timestamp: number,
  ): Promise<boolean> {
    const now = Date.now();
    if (Math.abs(now - timestamp) > 30000) {
      client.emit('call_error', {
        code: 'CLOCK_SKEW_EXCEEDED',
        message: 'Timestamp skew > 30s',
      });
      return false;
    }

    const nonceKey = `replay:nonce:${sessionId}:${nonce}`;
    const claimed = await this.redis.setNxEx(nonceKey, '1', 60);
    if (!claimed) {
      client.emit('call_error', {
        code: 'REPLAY_DETECTED',
        message: 'Signaling nonce already used',
      });
      return false;
    }

    const seqKey = `seq:webrtc:${sessionId}:${senderId}`;
    const validSeq = await this.redis.verifyAndSetSequence(seqKey, seq, 3600);
    if (!validSeq) {
      client.emit('call_error', {
        code: 'OUT_OF_ORDER_SEQUENCE',
        message: 'Out of order sequence',
      });
      return false;
    }

    return true;
  }

  @SubscribeMessage('webrtc.signal.offer')
  async handleWebrtcSignalOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WebrtcOfferWsDto,
  ): Promise<void> {
    if (!(await this.revalidateSensitiveSocket(client))) return;
    const data = client.data as AuthenticatedSocketData;
    if (!data || !data.userId) return;

    try {
      await this.assertWebrtcSignalAccess(client, data, dto.sessionId);
      const isClean = await this.validateWebrtcAntiReplay(
        client,
        dto.sessionId,
        data.userId,
        dto.nonce,
        dto.seq,
        dto.timestamp,
      );
      if (!isClean) return;

      const envelope = formatRealtimeEvent(
        'webrtc.signal.offer',
        { sessionId: dto.sessionId, sdp: dto.sdp, seq: dto.seq, nonce: dto.nonce },
        { userId: data.userId, role: data.role, deviceId: data.deviceId, driverId: data.driverId },
      );
      this.server.to(`session:${dto.sessionId}`).emit('webrtc.signal.offer', envelope);
    } catch (err: unknown) {
      client.emit('call_error', { code: 'SIGNALING_FAILED', message: 'Failed to relay offer' });
    }
  }

  @SubscribeMessage('webrtc.signal.answer')
  async handleWebrtcSignalAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WebrtcAnswerWsDto,
  ): Promise<void> {
    if (!(await this.revalidateSensitiveSocket(client))) return;
    const data = client.data as AuthenticatedSocketData;
    if (!data || !data.userId) return;

    try {
      await this.assertWebrtcSignalAccess(client, data, dto.sessionId);
      const isClean = await this.validateWebrtcAntiReplay(
        client,
        dto.sessionId,
        data.userId,
        dto.nonce,
        dto.seq,
        dto.timestamp,
      );
      if (!isClean) return;

      const envelope = formatRealtimeEvent(
        'webrtc.signal.answer',
        { sessionId: dto.sessionId, sdp: dto.sdp, seq: dto.seq, nonce: dto.nonce },
        { userId: data.userId, role: data.role, deviceId: data.deviceId, driverId: data.driverId },
      );
      this.server.to(`session:${dto.sessionId}`).emit('webrtc.signal.answer', envelope);
    } catch (err: unknown) {
      client.emit('call_error', { code: 'SIGNALING_FAILED', message: 'Failed to relay answer' });
    }
  }

  @SubscribeMessage('webrtc.signal.ice_candidate')
  async handleWebrtcSignalIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WebrtcIceCandidateWsDto,
  ): Promise<void> {
    if (!(await this.revalidateSensitiveSocket(client))) return;
    const data = client.data as AuthenticatedSocketData;
    if (!data || !data.userId) return;

    try {
      await this.assertWebrtcSignalAccess(client, data, dto.sessionId);
      const isClean = await this.validateWebrtcAntiReplay(
        client,
        dto.sessionId,
        data.userId,
        dto.nonce,
        dto.seq,
        dto.timestamp,
      );
      if (!isClean) return;

      // ICE candidate rate limiting per session (Max 50 candidates per socket)
      const candidateCount = await this.redis.incrRateLimit(`throttle:ice:${client.id}:${dto.sessionId}`, 60);
      if (candidateCount > 50) {
        client.emit('call_error', { code: 'ICE_CANDIDATE_LIMIT_EXCEEDED', message: 'Too many ICE candidates' });
        return;
      }

      const envelope = formatRealtimeEvent(
        'webrtc.signal.ice_candidate',
        { sessionId: dto.sessionId, candidate: dto.candidate, seq: dto.seq, nonce: dto.nonce },
        { userId: data.userId, role: data.role, deviceId: data.deviceId, driverId: data.driverId },
      );
      this.server.to(`session:${dto.sessionId}`).emit('webrtc.signal.ice_candidate', envelope);
    } catch (err: unknown) {
      client.emit('call_error', { code: 'SIGNALING_FAILED', message: 'Failed to relay ICE candidate' });
    }
  }

  private async assertWebrtcSignalAccess(
    client: Socket,
    data: AuthenticatedSocketData,
    sessionId: string,
  ): Promise<void> {
    if (!client.rooms.has(`session:${sessionId}`)) {
      throw new ForbiddenException({
        code: 'ROOM_ACCESS_DENIED',
        message: 'Join the call session room before sending signaling messages',
      });
    }

    await this.callSessionService.authorizeSignal(sessionId, {
      userId: data.userId,
      role: data.role,
      driverId: data.driverId,
      deviceId: data.deviceId,
    });
  }

  @SubscribeMessage('webrtc.call.hangup')
  async handleWebrtcCallHangup(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WebrtcHangupWsDto,
  ): Promise<void> {
    if (!(await this.revalidateSensitiveSocket(client))) return;
    const data = client.data as AuthenticatedSocketData;
    if (!data || !data.userId) return;

    try {
      await this.callSessionService.endCallSession(dto.sessionId, {
        userId: data.userId,
        role: data.role,
        driverId: data.driverId,
      });
    } catch (err: unknown) {
      client.emit('call_error', { code: 'HANGUP_FAILED', message: 'Failed to end call' });
    }
  }
}

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
import { Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { WsJwtAuthGuard, AuthenticatedSocketData } from '../guards/ws-jwt-auth.guard';
import { WsConnectionManagerService } from '../services/ws-connection-manager.service';
import { RedisService } from '../../../common/redis/redis.service';
import { formatRealtimeEvent } from '../dto/realtime-envelope.dto';

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
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
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
}

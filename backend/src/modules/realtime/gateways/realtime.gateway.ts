import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WsJwtAuthGuard } from '../guards/ws-jwt-auth.guard';
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
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly wsJwtAuthGuard: WsJwtAuthGuard,
    private readonly connectionManager: WsConnectionManagerService,
    private readonly redis: RedisService,
  ) {}

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
  }

  handleDisconnect(client: Socket) {
    this.connectionManager.removeSocket(client.id);
    this.logger.log(`WS client disconnected: ${client.id}`);
  }
}

import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WsJwtAuthGuard } from '../guards/ws-jwt-auth.guard';
import { WsConnectionManagerService } from '../services/ws-connection-manager.service';
import { formatRealtimeEvent } from '../dto/realtime-envelope.dto';

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
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly wsJwtAuthGuard: WsJwtAuthGuard,
    private readonly connectionManager: WsConnectionManagerService,
  ) {}

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

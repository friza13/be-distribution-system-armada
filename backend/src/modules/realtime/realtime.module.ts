import { Module, Global, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { TrackingModule } from '../tracking/tracking.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { CommunicationModule } from '../communication/communication.module';
import { RealtimeGateway } from './gateways/realtime.gateway';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';
import { WsConnectionManagerService } from './services/ws-connection-manager.service';
import { WsRoomAuthorizerService } from './services/ws-room-authorizer.service';

@Global()
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    forwardRef(() => TrackingModule),
    forwardRef(() => ConversationsModule),
    forwardRef(() => CommunicationModule),
  ],
  providers: [
    RealtimeGateway,
    WsJwtAuthGuard,
    WsConnectionManagerService,
    WsRoomAuthorizerService,
  ],
  exports: [
    RealtimeGateway,
    WsJwtAuthGuard,
    WsConnectionManagerService,
    WsRoomAuthorizerService,
  ],
})
export class RealtimeModule {}

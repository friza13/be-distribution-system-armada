import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeGateway } from './gateways/realtime.gateway';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';
import { WsConnectionManagerService } from './services/ws-connection-manager.service';

@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [RealtimeGateway, WsJwtAuthGuard, WsConnectionManagerService],
  exports: [RealtimeGateway, WsJwtAuthGuard, WsConnectionManagerService],
})
export class RealtimeModule {}

import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TurnCredentialService } from './services/turn-credential.service';
import { CallSessionService } from './services/call-session.service';
import { CommunicationController } from './communication.controller';

@Module({
  imports: [PrismaModule, RedisModule, forwardRef(() => RealtimeModule)],
  controllers: [CommunicationController],
  providers: [TurnCredentialService, CallSessionService],
  exports: [TurnCredentialService, CallSessionService],
})
export class CommunicationModule {}

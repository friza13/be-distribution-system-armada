import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ConversationsService } from './conversations.service';
import { MessagesService } from './messages.service';
import { ConversationsController } from './conversations.controller';

@Module({
  imports: [PrismaModule, RedisModule, forwardRef(() => RealtimeModule)],
  controllers: [ConversationsController],
  providers: [ConversationsService, MessagesService],
  exports: [ConversationsService, MessagesService],
})
export class ConversationsModule {}

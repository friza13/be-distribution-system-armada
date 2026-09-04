import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { FcmNotificationProvider } from './providers/fcm-notification.provider';
import { NotificationService } from './services/notification.service';
import { NotificationController } from './notification.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [NotificationController],
  providers: [FcmNotificationProvider, NotificationService],
  exports: [FcmNotificationProvider, NotificationService],
})
export class NotificationModule {}

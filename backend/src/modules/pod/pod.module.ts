import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { LocalPrivateStorageAdapter } from './adapters/local-private-storage.adapter';
import { FileStorageService } from './services/file-storage.service';
import { PodService } from './services/pod.service';
import { PodController } from './pod.controller';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    forwardRef(() => DeliveriesModule),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [PodController],
  providers: [LocalPrivateStorageAdapter, FileStorageService, PodService],
  exports: [FileStorageService, PodService],
})
export class PodModule {}

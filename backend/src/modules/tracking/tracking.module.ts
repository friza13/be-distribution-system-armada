import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { LocationValidationService } from './services/location-validation.service';
import { TrackingService } from './services/tracking.service';
import { TrackingCacheService } from './services/tracking-cache.service';
import { TrackingController } from './tracking.controller';

@Module({
  imports: [PrismaModule, RedisModule, forwardRef(() => RealtimeModule)],
  controllers: [TrackingController],
  providers: [LocationValidationService, TrackingService, TrackingCacheService],
  exports: [LocationValidationService, TrackingService, TrackingCacheService],
})
export class TrackingModule {}

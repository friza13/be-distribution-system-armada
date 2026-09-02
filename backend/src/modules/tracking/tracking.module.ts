import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { LocationValidationService } from './services/location-validation.service';
import { TrackingService } from './services/tracking.service';
import { TrackingController } from './tracking.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [TrackingController],
  providers: [LocationValidationService, TrackingService],
  exports: [LocationValidationService, TrackingService],
})
export class TrackingModule {}

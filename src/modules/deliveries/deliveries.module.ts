import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PodModule } from '../pod/pod.module';
import { DeliveriesService } from './services/deliveries.service';
import { DeliveryStopsService } from './services/delivery-stops.service';
import { DeliveryConflictsService } from './services/delivery-conflicts.service';
import { DeliveriesController } from './deliveries.controller';
import { StopsController } from './stops.controller';
import { ConflictsController } from './conflicts.controller';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    forwardRef(() => PodModule),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [DeliveriesController, StopsController, ConflictsController],
  providers: [DeliveriesService, DeliveryStopsService, DeliveryConflictsService],
  exports: [DeliveriesService, DeliveryStopsService, DeliveryConflictsService],
})
export class DeliveriesModule {}

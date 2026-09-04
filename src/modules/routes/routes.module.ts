import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { HaversineRoutingProvider } from './providers/haversine-routing.provider';
import { OsrmRoutingProvider } from './providers/osrm-routing.provider';
import { RoutingService } from './services/routing.service';
import { RouteOptimizerService } from './services/route-optimizer.service';
import { RoutesDomainService } from './services/routes-domain.service';
import { RoutesController } from './routes.controller';

@Module({
  imports: [PrismaModule, RedisModule, forwardRef(() => RealtimeModule)],
  controllers: [RoutesController],
  providers: [
    HaversineRoutingProvider,
    OsrmRoutingProvider,
    RoutingService,
    RouteOptimizerService,
    RoutesDomainService,
  ],
  exports: [
    RoutingService,
    RouteOptimizerService,
    RoutesDomainService,
  ],
})
export class RoutesModule {}

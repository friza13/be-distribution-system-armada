import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { SessionModule } from './modules/sessions/session.module';
import { DeviceModule } from './modules/devices/device.module';
import { UsersModule } from './modules/users/users.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { E2eeKeysModule } from './modules/e2ee-keys/e2ee-keys.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { RoutesModule } from './modules/routes/routes.module';
import { PodModule } from './modules/pod/pod.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { EmergenciesModule } from './modules/emergencies/emergencies.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    PrismaModule,
    RedisModule,
    SessionModule,
    AuthModule,
    DeviceModule,
    UsersModule,
    DeliveriesModule,
    E2eeKeysModule,
    RealtimeModule,
    TrackingModule,
    FleetModule,
    RoutesModule,
    PodModule,
    ConversationsModule,
    CommunicationModule,
    NotificationModule,
    EmergenciesModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}

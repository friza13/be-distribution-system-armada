import { Module, forwardRef } from '@nestjs/common';
import { EmergenciesService } from './emergencies.service';
import { EmergenciesController } from './emergencies.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [forwardRef(() => RealtimeModule)],
  controllers: [EmergenciesController],
  providers: [EmergenciesService],
  exports: [EmergenciesService],
})
export class EmergenciesModule {}

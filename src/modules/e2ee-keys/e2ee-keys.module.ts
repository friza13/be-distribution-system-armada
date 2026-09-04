import { Module } from '@nestjs/common';
import { E2eeKeysService } from './e2ee-keys.service';
import { E2eeKeysController } from './e2ee-keys.controller';

@Module({
  controllers: [E2eeKeysController],
  providers: [E2eeKeysService],
  exports: [E2eeKeysService],
})
export class E2eeKeysModule {}

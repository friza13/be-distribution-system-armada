import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { E2eeKeysService } from './e2ee-keys.service';
import { RegisterDeviceKeysDto } from './dto/register-device-keys.dto';
import { UploadPrekeysDto } from './dto/upload-prekeys.dto';

@Controller('e2ee/keys')
@UseGuards(AuthGuard('jwt'))
export class E2eeKeysController {
  constructor(private readonly e2eeKeysService: E2eeKeysService) {}

  @Post('register')
  async registerKeys(@Req() req: any, @Body() dto: RegisterDeviceKeysDto) {
    return this.e2eeKeysService.registerDeviceKeys(dto, req.user.id);
  }

  @Post('prekeys')
  async uploadPrekeys(@Req() req: any, @Body() dto: UploadPrekeysDto) {
    return this.e2eeKeysService.uploadPrekeys(dto, req.user.id);
  }

  @Get('bundle/:deviceId')
  async getBundle(@Param('deviceId') targetDeviceId: string) {
    return this.e2eeKeysService.consumePrekeyBundle(targetDeviceId);
  }

  @Get('status/:deviceId')
  async getStatus(@Req() req: any, @Param('deviceId') deviceId: string) {
    return this.e2eeKeysService.getPrekeyStatus(deviceId, req.user.id);
  }
}

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
import { DeviceService } from './device.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Controller('devices')
@UseGuards(AuthGuard('jwt'))
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post('register')
  async register(@Req() req: any, @Body() dto: RegisterDeviceDto) {
    return this.deviceService.registerDevice(req.user.id, dto);
  }

  @Post(':id/revoke')
  async revoke(@Req() req: any, @Param('id') deviceId: string) {
    return this.deviceService.revokeDevice(
      deviceId,
      req.user.id,
      req.user.role,
    );
  }

  @Get('my-devices')
  async getMyDevices(@Req() req: any) {
    return this.deviceService.getUserDevices(req.user.id);
  }
}

import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  ForbiddenException,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DeliveryStopsService } from './services/delivery-stops.service';
import { FailStopDto, SkipStopDto } from './dto/stop-status.dto';

@Controller('me/stops')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StopsController {
  constructor(private readonly deliveryStopsService: DeliveryStopsService) {}

  @Post(':id/depart')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.OK)
  async departToStop(
    @Param('id', new ParseUUIDPipe({ version: '4' })) stopId: string,
    @CurrentUser() user: any,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({ code: 'DRIVER_PROFILE_REQUIRED', message: 'Driver profile required' });
    }
    return this.deliveryStopsService.departToStop(stopId, user.driverId, user.id);
  }

  @Post(':id/arrive')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.OK)
  async arriveAtStop(
    @Param('id', new ParseUUIDPipe({ version: '4' })) stopId: string,
    @CurrentUser() user: any,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({ code: 'DRIVER_PROFILE_REQUIRED', message: 'Driver profile required' });
    }
    return this.deliveryStopsService.arriveAtStop(stopId, user.driverId, user.id);
  }

  @Post(':id/unload')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.OK)
  async startUnloading(
    @Param('id', new ParseUUIDPipe({ version: '4' })) stopId: string,
    @CurrentUser() user: any,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({ code: 'DRIVER_PROFILE_REQUIRED', message: 'Driver profile required' });
    }
    return this.deliveryStopsService.startUnloading(stopId, user.driverId, user.id);
  }

  @Post(':id/fail')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.OK)
  async failStop(
    @Param('id', new ParseUUIDPipe({ version: '4' })) stopId: string,
    @Body() dto: FailStopDto,
    @CurrentUser() user: any,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({ code: 'DRIVER_PROFILE_REQUIRED', message: 'Driver profile required' });
    }
    return this.deliveryStopsService.failStop(stopId, dto, user.driverId, user.id);
  }

  @Post(':id/skip')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  @HttpCode(HttpStatus.OK)
  async skipStop(
    @Param('id', new ParseUUIDPipe({ version: '4' })) stopId: string,
    @Body() dto: SkipStopDto,
    @CurrentUser() user: any,
  ) {
    return this.deliveryStopsService.skipStop(stopId, dto, {
      userId: user.id,
      role: user.role,
      driverId: user.driverId || null,
    });
  }
}

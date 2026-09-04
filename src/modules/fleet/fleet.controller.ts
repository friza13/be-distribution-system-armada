import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FleetService } from './fleet.service';
import { LocationHistoryQueryDto } from './dto/location-history-query.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  @Get('fleet/locations')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  async getFleetLocations(@CurrentUser() user: any) {
    return this.fleetService.getAllActiveDriverLocations(user.id, user.role);
  }

  @Get('drivers/:id/location-history')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async getDriverLocationHistory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) driverId: string,
    @Query() query: LocationHistoryQueryDto,
    @CurrentUser() user: any,
  ) {
    return this.fleetService.getDriverLocationHistory(
      driverId,
      query,
      user.id,
      user.role,
      user.driverId || null,
    );
  }
}

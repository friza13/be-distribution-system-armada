import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EmergenciesService } from './emergencies.service';
import { TriggerEmergencyDto } from './dto/trigger-emergency.dto';
import { UpdateEmergencyStatusDto } from './dto/update-emergency-status.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmergenciesController {
  constructor(private readonly emergenciesService: EmergenciesService) {}

  @Post('me/emergencies')
  @Roles('DRIVER')
  async triggerEmergency(@CurrentUser() user: any, @Body() dto: TriggerEmergencyDto) {
    if (!user.driverId) {
      throw new ForbiddenException({
        code: 'DRIVER_PROFILE_REQUIRED',
        message: 'Driver profile required to trigger emergency',
      });
    }
    return this.emergenciesService.triggerEmergency(user.driverId, user.id, dto);
  }

  @Get('me/emergencies/active')
  @Roles('DRIVER')
  async getActiveEmergency(@CurrentUser() user: any) {
    if (!user.driverId) {
      throw new ForbiddenException({
        code: 'DRIVER_PROFILE_REQUIRED',
        message: 'Driver profile required',
      });
    }
    return this.emergenciesService.getActiveEmergency(user.driverId);
  }

  @Get('emergencies')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  async listEmergencies(@CurrentUser() user: any) {
    return this.emergenciesService.listEmergencies({
      userId: user.id,
      role: user.role,
      organizationId: user.organizationId,
    });
  }

  @Get('emergencies/:id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  async getEmergencyById(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.emergenciesService.getEmergencyById(id);
  }

  @Patch('emergencies/:id/status')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  async updateEmergencyStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateEmergencyStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.emergenciesService.updateEmergencyStatus(id, dto, user.id);
  }
}

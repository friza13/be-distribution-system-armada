import {
  Controller,
  Get,
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
import { DeliveriesService, DeliveryActor } from './services/deliveries.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { AssignDeliveryDto } from './dto/assign-delivery.dto';
import { CancelDeliveryDto } from './dto/cancel-delivery.dto';

@Controller('deliveries')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  private extractActor(user: any): DeliveryActor {
    return {
      userId: user.id,
      role: user.role,
      driverId: user.driverId || null,
    };
  }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  @HttpCode(HttpStatus.CREATED)
  async createDelivery(
    @CurrentUser() user: any,
    @Body() dto: CreateDeliveryDto,
  ) {
    return this.deliveriesService.createDelivery(dto, user.id);
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async getDelivery(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: any,
  ) {
    return this.deliveriesService.getDeliveryById(id, this.extractActor(user));
  }

  @Post(':id/assign')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  @HttpCode(HttpStatus.OK)
  async assignDelivery(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AssignDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.deliveriesService.assignDelivery(id, dto, this.extractActor(user));
  }

  @Post(':id/accept')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.OK)
  async acceptDelivery(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: any,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({
        code: 'DRIVER_PROFILE_REQUIRED',
        message: 'Driver profile required',
      });
    }
    return this.deliveriesService.acceptDelivery(id, user.driverId, user.id);
  }

  @Post(':id/start')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.OK)
  async startDelivery(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: any,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({
        code: 'DRIVER_PROFILE_REQUIRED',
        message: 'Driver profile required',
      });
    }
    return this.deliveriesService.startDelivery(id, user.driverId, user.id);
  }

  @Post(':id/complete')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  @HttpCode(HttpStatus.OK)
  async completeDelivery(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: any,
  ) {
    return this.deliveriesService.completeDelivery(id, this.extractActor(user));
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  @HttpCode(HttpStatus.OK)
  async cancelDelivery(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CancelDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.deliveriesService.cancelDelivery(id, dto, this.extractActor(user));
  }
}

import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoutesDomainService, RouteActor } from './services/routes-domain.service';
import { RecommendRouteDto } from './dto/recommend-route.dto';
import { SelectRouteDto } from './dto/select-route.dto';
import { ManualReorderDto } from './dto/manual-reorder.dto';

@Controller('deliveries/:id/routes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RoutesController {
  constructor(private readonly routesDomainService: RoutesDomainService) {}

  private extractActor(user: any): RouteActor {
    return {
      userId: user.id,
      role: user.role,
      driverId: user.driverId || null,
    };
  }

  @Post('recommend')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  @HttpCode(HttpStatus.OK)
  async recommendRoute(
    @Param('id', new ParseUUIDPipe({ version: '4' })) deliveryId: string,
    @Query() dto: RecommendRouteDto,
    @CurrentUser() user: any,
  ) {
    return this.routesDomainService.recommendRoute(deliveryId, dto, this.extractActor(user));
  }

  @Post('select')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async selectRoute(
    @Param('id', new ParseUUIDPipe({ version: '4' })) deliveryId: string,
    @Body() dto: SelectRouteDto,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.routesDomainService.selectRoute(
      deliveryId,
      dto,
      this.extractActor(user),
      '/v1/deliveries/:id/routes/select',
    );

    if (result.idempotent) {
      res.status(HttpStatus.OK);
    } else {
      res.status(HttpStatus.CREATED);
    }

    return result;
  }

  @Patch('reorder')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  @HttpCode(HttpStatus.OK)
  async reorderStops(
    @Param('id', new ParseUUIDPipe({ version: '4' })) deliveryId: string,
    @Body() dto: ManualReorderDto,
    @CurrentUser() user: any,
  ) {
    return this.routesDomainService.reorderStops(
      deliveryId,
      dto,
      this.extractActor(user),
      '/v1/deliveries/:id/routes/reorder',
    );
  }

  @Get('current')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async getCurrentRoute(
    @Param('id', new ParseUUIDPipe({ version: '4' })) deliveryId: string,
    @CurrentUser() user: any,
  ) {
    return this.routesDomainService.getCurrentRoute(deliveryId, this.extractActor(user));
  }

  @Get('versions')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async getRouteVersions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) deliveryId: string,
    @CurrentUser() user: any,
  ) {
    return this.routesDomainService.getRouteVersions(deliveryId, this.extractActor(user));
  }
}

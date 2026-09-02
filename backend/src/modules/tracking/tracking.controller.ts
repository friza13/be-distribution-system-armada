import {
  Controller,
  Post,
  Body,
  UseGuards,
  ForbiddenException,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TrackingService } from './services/tracking.service';
import { LocationIngestionDto } from './dto/location-ingestion.dto';
import { LocationBatchIngestionDto } from './dto/location-batch-ingestion.dto';

@Controller('me/location')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post()
  @Roles('DRIVER')
  async ingestSingleLocation(
    @CurrentUser() user: any,
    @Body() dto: LocationIngestionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({
        code: 'DRIVER_PROFILE_REQUIRED',
        message: 'Authenticated user does not have an associated driver profile',
      });
    }

    const result = await this.trackingService.processTelemetry(
      dto,
      user.driverId,
      user.role,
      new Date(),
      '/v1/me/location',
    );

    // If request was idempotent duplicate (already processed), return 200 OK semantics
    if (result.idempotent) {
      res.status(HttpStatus.OK);
      return {
        locationId: result.locationId,
        validationStatus: result.validationStatus,
        receivedAt: result.receivedAt,
        idempotent: true,
      };
    }

    res.status(HttpStatus.CREATED);
    return result;
  }

  @Post('batch')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.CREATED)
  async ingestBatchLocation(
    @CurrentUser() user: any,
    @Body() batchDto: LocationBatchIngestionDto,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({
        code: 'DRIVER_PROFILE_REQUIRED',
        message: 'Authenticated user does not have an associated driver profile',
      });
    }

    return this.trackingService.processBatch(
      batchDto,
      user.driverId,
      user.role,
      new Date(),
    );
  }
}

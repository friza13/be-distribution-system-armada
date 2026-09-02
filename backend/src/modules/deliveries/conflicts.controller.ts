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
import { DeliveryConflictsService } from './services/delivery-conflicts.service';
import { OutboxSyncDto } from './dto/outbox-sync.dto';
import { ResolveConflictDto } from './dto/resolve-conflict.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConflictsController {
  constructor(private readonly conflictsService: DeliveryConflictsService) {}

  @Post('me/sync/outbox')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.CREATED)
  async syncOutbox(
    @CurrentUser() user: any,
    @Body() dto: OutboxSyncDto,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({ code: 'DRIVER_PROFILE_REQUIRED', message: 'Driver profile required' });
    }

    return this.conflictsService.syncOutbox(dto, user.driverId, user.id);
  }

  @Get('conflicts')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  async getOpenConflicts(@CurrentUser() user: any) {
    return this.conflictsService.getOpenConflicts(user.id, user.role);
  }

  @Post('conflicts/:id/resolve')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  @HttpCode(HttpStatus.OK)
  async resolveConflict(
    @Param('id', new ParseUUIDPipe({ version: '4' })) conflictId: string,
    @Body() dto: ResolveConflictDto,
    @CurrentUser() user: any,
  ) {
    return this.conflictsService.resolveConflict(conflictId, dto, user.id, user.role);
  }
}

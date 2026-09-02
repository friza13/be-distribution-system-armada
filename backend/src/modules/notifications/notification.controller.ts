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
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationService } from './services/notification.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('devices/register-push-token')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  @HttpCode(HttpStatus.OK)
  async registerPushToken(
    @CurrentUser() user: any,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.notificationService.registerPushToken(dto, user.id);
  }

  @Get('notifications')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async getUserNotifications(
    @CurrentUser() user: any,
    @Query() query: GetNotificationsQueryDto,
  ) {
    return this.notificationService.getUserNotifications(user.id, query);
  }

  @Patch('notifications/:id/read')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  @HttpCode(HttpStatus.OK)
  async markNotificationRead(
    @Param('id', new ParseUUIDPipe({ version: '4' })) notificationId: string,
    @CurrentUser() user: any,
  ) {
    return this.notificationService.markAsRead(notificationId, user.id);
  }
}

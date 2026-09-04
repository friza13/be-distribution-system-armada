import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@Req() req: any) {
    return this.usersService.getUserById(req.user.id);
  }

  @Patch(':id/role')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @RequirePermissions('user:manage')
  async updateRole(
    @Param('id') targetUserId: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: any,
  ) {
    return this.usersService.updateUserRole(
      targetUserId,
      dto.roleCode,
      req.user.id,
    );
  }

  @Patch(':id/status')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @RequirePermissions('user:manage')
  async updateStatus(
    @Param('id') targetUserId: string,
    @Body() dto: UpdateStatusDto,
    @Req() req: any,
  ) {
    return this.usersService.updateUserStatus(
      targetUserId,
      dto.status,
      req.user.id,
    );
  }

  @Post(':id/reset-password')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @RequirePermissions('user:manage')
  async resetPassword(
    @Param('id') targetUserId: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: any,
  ) {
    return this.usersService.adminResetPassword(
      targetUserId,
      dto.newPassword,
      req.user.id,
    );
  }
}

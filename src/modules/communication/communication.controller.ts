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
import { CallSessionService, UserActor } from './services/call-session.service';
import { InitiateCallDto } from './dto/initiate-call.dto';
import { CallResponseDto } from './dto/call-response.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommunicationController {
  constructor(private readonly callSessionService: CallSessionService) {}

  private extractActor(user: any): UserActor {
    return {
      userId: user.id,
      role: user.role,
      driverId: user.driverId || null,
      deviceId: user.deviceId || null,
    };
  }

  @Post('voice-sessions')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  @HttpCode(HttpStatus.CREATED)
  async initiateVoiceSession(
    @CurrentUser() user: any,
    @Body() dto: InitiateCallDto,
  ) {
    return this.callSessionService.initiateCallSession(
      { ...dto, type: 'VOICE_PTT' },
      this.extractActor(user),
    );
  }

  @Post('video-sessions')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  @HttpCode(HttpStatus.CREATED)
  async initiateVideoSession(
    @CurrentUser() user: any,
    @Body() dto: InitiateCallDto,
  ) {
    return this.callSessionService.initiateCallSession(
      { ...dto, type: 'VIDEO' },
      this.extractActor(user),
    );
  }

  @Post('realtime/sessions/:id/respond')
  @Roles('DRIVER', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  @HttpCode(HttpStatus.OK)
  async respondToCallSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @Body() dto: CallResponseDto,
    @CurrentUser() user: any,
  ) {
    return this.callSessionService.respondToCallSession(
      sessionId,
      dto.action,
      this.extractActor(user),
    );
  }

  @Post('realtime/sessions/:id/end')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  @HttpCode(HttpStatus.OK)
  async endCallSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentUser() user: any,
  ) {
    return this.callSessionService.endCallSession(sessionId, this.extractActor(user));
  }
}

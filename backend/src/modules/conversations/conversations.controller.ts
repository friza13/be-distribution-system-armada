import {
  Controller,
  Get,
  Post,
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
import { ConversationsService, UserActor } from './conversations.service';
import { MessagesService } from './messages.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
  ) {}

  private extractActor(user: any): UserActor {
    return {
      userId: user.id,
      role: user.role,
      driverId: user.driverId || null,
      deviceId: user.deviceId || null,
    };
  }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER')
  @HttpCode(HttpStatus.CREATED)
  async createConversation(
    @CurrentUser() user: any,
    @Body() dto: CreateConversationDto,
  ) {
    return this.conversationsService.createConversation(dto, this.extractActor(user));
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async getUserConversations(@CurrentUser() user: any) {
    return this.conversationsService.getUserConversations(this.extractActor(user));
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async getConversationDetails(
    @Param('id', new ParseUUIDPipe({ version: '4' })) conversationId: string,
    @CurrentUser() user: any,
  ) {
    return this.conversationsService.verifyConversationAccess(conversationId, this.extractActor(user));
  }

  @Get(':id/messages')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async getMessages(
    @Param('id', new ParseUUIDPipe({ version: '4' })) conversationId: string,
    @Query() query: GetMessagesQueryDto,
    @CurrentUser() user: any,
  ) {
    return this.messagesService.getMessages(conversationId, query, this.extractActor(user));
  }

  @Post(':id/messages')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async sendMessage(
    @Param('id', new ParseUUIDPipe({ version: '4' })) conversationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.messagesService.sendMessage(
      conversationId,
      dto,
      this.extractActor(user),
      '/v1/conversations/:id/messages',
    );

    if (result.idempotent) {
      res.status(HttpStatus.OK);
    } else {
      res.status(HttpStatus.CREATED);
    }

    return result;
  }
}

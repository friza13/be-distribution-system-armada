import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';

export interface UserActor {
  userId: string;
  role: string;
  driverId?: string | null;
  deviceId?: string;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createConversation(dto: CreateConversationDto, actor: UserActor) {
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Owner or Admin can initiate a new conversation with a Driver',
      });
    }

    const driver = await this.prisma.driver.findUnique({
      where: { id: dto.driverId },
    });

    if (!driver) {
      throw new NotFoundException({
        code: 'DRIVER_NOT_FOUND',
        message: `Driver with ID ${dto.driverId} not found`,
      });
    }

    // Upsert conversation for (ownerId, driverId)
    const conversation = await this.prisma.conversation.upsert({
      where: {
        ownerId_driverId: {
          ownerId: actor.userId,
          driverId: dto.driverId,
        },
      },
      update: { status: 'ACTIVE' },
      create: {
        ownerId: actor.userId,
        driverId: dto.driverId,
        status: 'ACTIVE',
      },
      include: {
        owner: { select: { id: true, username: true, phone: true } },
        driver: { select: { id: true, displayName: true, phone: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'CONVERSATION_CREATED',
        entityType: 'CONVERSATION',
        entityId: conversation.id,
        result: 'SUCCESS',
        afterJson: { driverId: dto.driverId },
      },
    });

    return conversation;
  }

  async getUserConversations(actor: UserActor) {
    if (actor.role === 'DRIVER') {
      if (!actor.driverId) {
        return [];
      }
      return this.prisma.conversation.findMany({
        where: { driverId: actor.driverId, status: 'ACTIVE' },
        include: {
          owner: { select: { id: true, username: true } },
          driver: { select: { id: true, displayName: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Owner / Admin
    return this.prisma.conversation.findMany({
      where: { ownerId: actor.userId, status: 'ACTIVE' },
      include: {
        owner: { select: { id: true, username: true } },
        driver: { select: { id: true, displayName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async verifyConversationAccess(conversationId: string, actor: UserActor) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        owner: { select: { id: true, username: true } },
        driver: { select: { id: true, displayName: true } },
      },
    });

    if (!conversation) {
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: `Conversation with ID ${conversationId} not found`,
      });
    }

    if (actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN') {
      return conversation;
    }

    const isOwner = conversation.ownerId === actor.userId;
    const isDriver = actor.driverId && conversation.driverId === actor.driverId;

    if (!isOwner && !isDriver) {
      this.logger.warn(
        `Anti-IDOR rejection: User ${actor.userId} (role: ${actor.role}) attempted to access conversation ${conversationId}`,
      );
      throw new ForbiddenException({
        code: 'RESOURCE_FORBIDDEN',
        message: 'You are not a participant in this conversation',
      });
    }

    return conversation;
  }
}

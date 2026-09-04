import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { ConversationsService, UserActor } from './conversations.service';
import { SendMessageDto } from './dto/send-message.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { Prisma } from '@prisma/client';

export interface IngestedMessageResult {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  protocolVersion: number;
  ciphertextBlob: string;
  headerJson: Record<string, any>;
  createdAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  idempotent?: boolean;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async sendMessage(
    conversationId: string,
    dto: SendMessageDto,
    actor: UserActor,
    endpoint: string = '/v1/conversations/:id/messages',
  ): Promise<IngestedMessageResult> {
    // 1. Verify Conversation Access & Membership (Anti-IDOR)
    const conversation = await this.conversationsService.verifyConversationAccess(
      conversationId,
      actor,
    );

    if (!actor.deviceId) {
      throw new ForbiddenException({
        code: 'DEVICE_ID_REQUIRED',
        message: 'Sender device context is missing',
      });
    }

    // 2. Verify Sender Device Status
    const senderDevice = await this.prisma.device.findUnique({
      where: { id: actor.deviceId },
    });

    if (!senderDevice || senderDevice.status === 'REVOKED') {
      throw new ForbiddenException({
        code: 'DEVICE_REVOKED',
        message: 'Sender device has been revoked',
      });
    }

    // 3. Verify Recipient Device
    const recipientDevice = await this.prisma.device.findUnique({
      where: { id: dto.recipientDeviceId },
    });

    if (!recipientDevice || recipientDevice.status === 'REVOKED') {
      throw new UnprocessableEntityException({
        code: 'RECIPIENT_DEVICE_INVALID',
        message: 'Recipient device is invalid or has been revoked',
      });
    }

    // 4. Rate Limiting: Max 10 messages per second per user
    const rateCount = await this.redisService.incrRateLimit(
      `throttle:chat:send:${actor.userId}`,
      1,
    );
    if (rateCount > 10) {
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Message sending rate limit exceeded (Max 10 msg/sec).',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 5. Race-Safe Idempotency Check via idempotencyRecords
    if (dto.idempotencyKey) {
      const existingRecord = await this.prisma.idempotencyRecord.findUnique({
        where: {
          key_userId_endpoint: {
            key: dto.idempotencyKey,
            userId: actor.userId,
            endpoint,
          },
        },
      });

      if (existingRecord) {
        const body = existingRecord.responseBody as any;
        return {
          id: body.id,
          conversationId: body.conversationId,
          senderUserId: body.senderUserId,
          senderDeviceId: body.senderDeviceId,
          recipientDeviceId: body.recipientDeviceId,
          protocolVersion: body.protocolVersion,
          ciphertextBlob: body.ciphertextBlob,
          headerJson: body.headerJson,
          createdAt: new Date(body.createdAt),
          deliveredAt: body.deliveredAt ? new Date(body.deliveredAt) : null,
          readAt: body.readAt ? new Date(body.readAt) : null,
          idempotent: true,
        };
      }
    }

    // 6. Zero Plaintext Invariant: Persist encrypted ciphertext blob directly
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderUserId: actor.userId,
        senderDeviceId: actor.deviceId,
        recipientDeviceId: dto.recipientDeviceId,
        protocolVersion: dto.protocolVersion || 1,
        ciphertextBlob: dto.ciphertextBlob,
        headerJson: dto.headerJson as unknown as Prisma.InputJsonValue,
      },
    });

    const result: IngestedMessageResult = {
      id: message.id,
      conversationId: message.conversationId,
      senderUserId: message.senderUserId,
      senderDeviceId: message.senderDeviceId,
      recipientDeviceId: message.recipientDeviceId,
      protocolVersion: message.protocolVersion,
      ciphertextBlob: message.ciphertextBlob,
      headerJson: message.headerJson as Record<string, any>,
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
    };

    // 7. Save Idempotency Record if key provided
    if (dto.idempotencyKey) {
      try {
        await this.prisma.idempotencyRecord.create({
          data: {
            key: dto.idempotencyKey,
            userId: actor.userId,
            endpoint,
            responseStatus: 201,
            responseBody: result as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
          },
        });
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          this.logger.debug(`Idempotency collision caught for message key ${dto.idempotencyKey}`);
        }
      }
    }

    return result;
  }

  async getMessages(
    conversationId: string,
    query: GetMessagesQueryDto,
    actor: UserActor,
  ) {
    await this.conversationsService.verifyConversationAccess(conversationId, actor);

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await this.prisma.message.count({
      where: { conversationId },
    });

    return {
      conversationId,
      messages: messages.map((m) => ({
        id: m.id,
        senderUserId: m.senderUserId,
        senderDeviceId: m.senderDeviceId,
        recipientDeviceId: m.recipientDeviceId,
        protocolVersion: m.protocolVersion,
        ciphertextBlob: m.ciphertextBlob,
        headerJson: m.headerJson,
        createdAt: m.createdAt,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
      })),
      pagination: {
        limit,
        offset,
        total,
      },
    };
  }

  async markMessageDelivered(messageId: string, actorUserId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return null;

    if (!message.deliveredAt) {
      const updated = await this.prisma.message.update({
        where: { id: messageId },
        data: { deliveredAt: new Date() },
      });
      return updated;
    }
    return message;
  }

  async markMessageRead(messageId: string, actorUserId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return null;

    const now = new Date();
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        deliveredAt: message.deliveredAt || now,
        readAt: now,
      },
    });
    return updated;
  }
}

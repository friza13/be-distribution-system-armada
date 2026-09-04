import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthenticatedSocketData } from '../guards/ws-jwt-auth.guard';

export interface RoomAuthorizationResult {
  authorized: boolean;
  reason?: string;
  normalizedRoom?: string;
}

@Injectable()
export class WsRoomAuthorizerService {
  private readonly logger = new Logger(WsRoomAuthorizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async authorizeRoomJoin(
    socketData: AuthenticatedSocketData,
    roomName: string,
  ): Promise<RoomAuthorizationResult> {
    if (!socketData || !socketData.userId) {
      return { authorized: false, reason: 'UNAUTHENTICATED' };
    }

    if (!roomName || typeof roomName !== 'string' || roomName.trim().length === 0) {
      return { authorized: false, reason: 'INVALID_ROOM_FORMAT' };
    }

    const trimmedRoom = roomName.trim();
    const parts = trimmedRoom.split(':');
    const category = parts[0];
    const resourceId = parts.slice(1).join(':');

    switch (category) {
      case 'delivery':
        return this.authorizeDeliveryRoom(socketData, resourceId, trimmedRoom);

      case 'conversation':
        return this.authorizeConversationRoom(socketData, resourceId, trimmedRoom);

      case 'session':
        return this.authorizeRealtimeSessionRoom(socketData, resourceId, trimmedRoom);

      case 'fleet':
        if (resourceId === 'monitoring') {
          return this.authorizeFleetMonitoringRoom(socketData, trimmedRoom);
        }
        return { authorized: false, reason: 'UNKNOWN_ROOM_PATTERN' };

      default:
        return { authorized: false, reason: 'UNKNOWN_ROOM_PATTERN' };
    }
  }

  private async authorizeDeliveryRoom(
    socketData: AuthenticatedSocketData,
    deliveryId: string,
    normalizedRoom: string,
  ): Promise<RoomAuthorizationResult> {
    if (!deliveryId) {
      return { authorized: false, reason: 'MISSING_DELIVERY_ID' };
    }

    // Role-based shortcut / verification
    const { role, driverId, userId, organizationId } = socketData;

    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        driverId: true,
        createdBy: true,
        organizationId: true,
      },
    });

    if (!delivery) {
      return { authorized: false, reason: 'DELIVERY_NOT_FOUND' };
    }

    // Admin & Super Admin have full operational access
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
      return { authorized: true, normalizedRoom };
    }

    // Owners are scoped to their own deliveries or organization
    if (role === 'OWNER') {
      const isCreator = delivery.createdBy === userId;
      const isSameOrg = organizationId && delivery.organizationId === organizationId;
      if (isCreator || isSameOrg) {
        return { authorized: true, normalizedRoom };
      }
      return { authorized: false, reason: 'ROOM_ACCESS_DENIED' };
    }

    // Driver can ONLY access delivery if assigned to them
    if (role === 'DRIVER') {
      if (driverId && delivery.driverId === driverId) {
        return { authorized: true, normalizedRoom };
      }
      this.logger.warn(
        `Anti-IDOR rejection: Driver ${driverId || userId} attempted to access delivery ${deliveryId} assigned to driver ${delivery.driverId}`,
      );
      return { authorized: false, reason: 'ROOM_ACCESS_DENIED' };
    }

    return { authorized: false, reason: 'ROOM_ACCESS_DENIED' };
  }

  private async authorizeConversationRoom(
    socketData: AuthenticatedSocketData,
    conversationId: string,
    normalizedRoom: string,
  ): Promise<RoomAuthorizationResult> {
    if (!conversationId) {
      return { authorized: false, reason: 'MISSING_CONVERSATION_ID' };
    }

    const { userId, driverId } = socketData;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        ownerId: true,
        driverId: true,
      },
    });

    if (!conversation) {
      return { authorized: false, reason: 'CONVERSATION_NOT_FOUND' };
    }

    // Participant verification (ownerId == userId OR driver.id == driverId)
    const isOwnerParticipant = conversation.ownerId === userId;
    const isDriverParticipant = driverId && conversation.driverId === driverId;

    if (isOwnerParticipant || isDriverParticipant) {
      return { authorized: true, normalizedRoom };
    }

    this.logger.warn(
      `Anti-IDOR rejection: User ${userId} attempted to access conversation ${conversationId} without participant membership`,
    );
    return { authorized: false, reason: 'ROOM_ACCESS_DENIED' };
  }

  private async authorizeRealtimeSessionRoom(
    socketData: AuthenticatedSocketData,
    sessionId: string,
    normalizedRoom: string,
  ): Promise<RoomAuthorizationResult> {
    if (!sessionId) {
      return { authorized: false, reason: 'MISSING_SESSION_ID' };
    }

    const { userId, driverId, role } = socketData;

    if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
      return { authorized: true, normalizedRoom };
    }

    const session = await this.prisma.realtimeSession.findUnique({
      where: { id: sessionId },
      select: { id: true, ownerId: true, driverId: true },
    });

    if (!session) {
      return { authorized: false, reason: 'SESSION_NOT_FOUND' };
    }

    const isOwner = session.ownerId === userId;
    const isDriver = driverId && session.driverId === driverId;

    if (isOwner || isDriver) {
      return { authorized: true, normalizedRoom };
    }

    this.logger.warn(
      `Anti-IDOR rejection: User ${userId} attempted to access call session room ${sessionId}`,
    );
    return { authorized: false, reason: 'ROOM_ACCESS_DENIED' };
  }

  private async authorizeFleetMonitoringRoom(
    socketData: AuthenticatedSocketData,
    normalizedRoom: string,
  ): Promise<RoomAuthorizationResult> {
    const { role } = socketData;

    // Strict Role Enforcement: Only ADMIN, SUPER_ADMIN, and OWNER can monitor fleet
    if (role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'OWNER') {
      return { authorized: true, normalizedRoom };
    }

    // DRIVER is strictly rejected from fleet monitoring
    this.logger.warn(
      `Anti-IDOR rejection: Driver ${socketData.userId} attempted to subscribe to fleet:monitoring`,
    );
    return { authorized: false, reason: 'ROOM_ACCESS_DENIED' };
  }
}

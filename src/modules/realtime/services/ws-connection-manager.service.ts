import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthenticatedSocketData } from '../guards/ws-jwt-auth.guard';

@Injectable()
export class WsConnectionManagerService {
  private readonly logger = new Logger(WsConnectionManagerService.name);

  // socketId -> Socket
  private readonly sockets = new Map<string, Socket>();

  // userId -> Set<socketId>
  private readonly userSockets = new Map<string, Set<string>>();

  // sessionId -> socketIds
  private readonly sessionSockets = new Map<string, Set<string>>();

  // deviceId -> socketIds
  private readonly deviceSockets = new Map<string, Set<string>>();

  // driverId -> socketId
  private readonly driverSockets = new Map<string, string>();

  registerSocket(socket: Socket): void {
    const data = socket.data as AuthenticatedSocketData;
    if (!data || !data.userId) {
      return;
    }

    const { userId, sessionId, deviceId, driverId, role } = data;
    const socketId = socket.id;

    // Driver Single Active Socket Policy:
    // If role is DRIVER and driverId exists, check if there is an older active socket.
    // If found, immediately disconnect the older socket with reason SUPERSEDED_BY_NEW_LOGIN.
    if (role === 'DRIVER' && driverId) {
      const existingSocketId = this.driverSockets.get(driverId);
      if (existingSocketId && existingSocketId !== socketId) {
        const existingSocket = this.sockets.get(existingSocketId);
        if (existingSocket) {
          this.logger.log(
            `Superseding older driver socket ${existingSocketId} for driver ${driverId}`,
          );
          existingSocket.emit('disconnect_notice', {
            event: 'disconnect_notice',
            reason: 'SUPERSEDED_BY_NEW_LOGIN',
            timestamp: new Date().toISOString(),
          });
          existingSocket.disconnect(true);
          this.removeSocket(existingSocketId);
        }
      }
    }

    this.sockets.set(socketId, socket);

    // Map User
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set<string>());
    }
    this.userSockets.get(userId)!.add(socketId);

    // Map all sockets for the session and device so revocation reaches every connection.
    this.addSocketToIndex(this.sessionSockets, sessionId, socketId);
    this.addSocketToIndex(this.deviceSockets, deviceId, socketId);

    // Map Driver
    if (driverId) {
      this.driverSockets.set(driverId, socketId);
    }

    this.logger.debug(
      `Socket registered: ${socketId} (userId: ${userId}, role: ${data.role}, driverId: ${driverId || 'none'})`,
    );
  }

  removeSocket(socketId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }

    const data = socket.data as AuthenticatedSocketData;
    if (data) {
      // Clear any pending heartbeat timers to prevent memory/timer leaks
      if (data.heartbeatIntervalTimer) {
        clearInterval(data.heartbeatIntervalTimer);
        data.heartbeatIntervalTimer = undefined;
      }
      if (data.pongTimeoutTimer) {
        clearTimeout(data.pongTimeoutTimer);
        data.pongTimeoutTimer = undefined;
      }

      const { userId, sessionId, deviceId, driverId } = data;

      if (userId && this.userSockets.has(userId)) {
        const userSet = this.userSockets.get(userId)!;
        userSet.delete(socketId);
        if (userSet.size === 0) {
          this.userSockets.delete(userId);
        }
      }

      this.removeSocketFromIndex(this.sessionSockets, sessionId, socketId);
      this.removeSocketFromIndex(this.deviceSockets, deviceId, socketId);

      if (driverId && this.driverSockets.get(driverId) === socketId) {
        this.driverSockets.delete(driverId);
      }
    }

    this.sockets.delete(socketId);
    this.logger.debug(`Socket removed: ${socketId}`);
  }

  getSocket(socketId?: string): Socket | undefined {
    if (!socketId) return undefined;
    return this.sockets.get(socketId);
  }

  getSocketsByUserId(userId: string): Socket[] {
    const socketIds = this.userSockets.get(userId);
    if (!socketIds) {
      return [];
    }
    const result: Socket[] = [];
    for (const id of socketIds) {
      const s = this.sockets.get(id);
      if (s) {
        result.push(s);
      }
    }
    return result;
  }

  getSocketsBySessionId(sessionId: string): Socket[] {
    return this.getSocketsFromIndex(this.sessionSockets, sessionId);
  }

  getSocketBySessionId(sessionId: string): Socket | undefined {
    return this.getSocketsBySessionId(sessionId)[0];
  }

  getSocketsByDeviceId(deviceId: string): Socket[] {
    return this.getSocketsFromIndex(this.deviceSockets, deviceId);
  }

  getSocketByDeviceId(deviceId: string): Socket | undefined {
    return this.getSocketsByDeviceId(deviceId)[0];
  }

  getSocketByDriverId(driverId: string): Socket | undefined {
    const socketId = this.driverSockets.get(driverId);
    return socketId ? this.sockets.get(socketId) : undefined;
  }

  getActiveConnectionCount(): number {
    return this.sockets.size;
  }

  disconnectSession(sessionId: string, reason: string = 'SESSION_REVOKED'): boolean {
    return this.disconnectSockets(
      this.getSocketsBySessionId(sessionId),
      reason,
      { sessionId },
    );
  }

  disconnectDevice(deviceId: string, reason: string = 'DEVICE_REVOKED'): boolean {
    return this.disconnectSockets(
      this.getSocketsByDeviceId(deviceId),
      reason,
      { deviceId },
    );
  }

  disconnectUser(userId: string, reason: string = 'USER_REVOKED'): number {
    const sockets = this.getSocketsByUserId(userId);
    this.logger.log(`Disconnecting ${sockets.length} socket(s) for revoked user ${userId}: ${reason}`);
    for (const socket of sockets) {
      socket.emit('disconnect_notice', {
        event: 'disconnect_notice',
        reason,
        userId,
        timestamp: new Date().toISOString(),
      });
      socket.disconnect(true);
      this.removeSocket(socket.id);
    }
    return sockets.length;
  }
  private addSocketToIndex(index: Map<string, Set<string>>, key: string | undefined, socketId: string): void {
    if (!key) return;
    let socketIds = index.get(key);
    if (!socketIds) {
      socketIds = new Set<string>();
      index.set(key, socketIds);
    }
    socketIds.add(socketId);
  }

  private removeSocketFromIndex(index: Map<string, Set<string>>, key: string | undefined, socketId: string): void {
    if (!key) return;
    const socketIds = index.get(key);
    if (!socketIds) return;
    socketIds.delete(socketId);
    if (socketIds.size === 0) {
      index.delete(key);
    }
  }

  private getSocketsFromIndex(index: Map<string, Set<string>>, key: string): Socket[] {
    const socketIds = index.get(key);
    if (!socketIds) return [];
    return Array.from(socketIds)
      .map((socketId) => this.sockets.get(socketId))
      .filter((socket): socket is Socket => Boolean(socket));
  }

  private disconnectSockets(sockets: Socket[], reason: string, details: Record<string, string>): boolean {
    for (const socket of sockets) {
      this.logger.log(`Disconnecting socket ${socket.id} due to revocation: ${reason}`);
      socket.emit('disconnect_notice', {
        event: 'disconnect_notice',
        reason,
        ...details,
        timestamp: new Date().toISOString(),
      });
      socket.disconnect(true);
      this.removeSocket(socket.id);
    }
    return sockets.length > 0;
  }

}

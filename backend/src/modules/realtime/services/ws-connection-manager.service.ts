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

  // sessionId -> socketId
  private readonly sessionSockets = new Map<string, string>();

  // deviceId -> socketId
  private readonly deviceSockets = new Map<string, string>();

  // driverId -> socketId
  private readonly driverSockets = new Map<string, string>();

  registerSocket(socket: Socket): void {
    const data = socket.data as AuthenticatedSocketData;
    if (!data || !data.userId) {
      return;
    }

    const { userId, sessionId, deviceId, driverId } = data;
    const socketId = socket.id;

    this.sockets.set(socketId, socket);

    // Map User
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set<string>());
    }
    this.userSockets.get(userId)!.add(socketId);

    // Map Session
    if (sessionId) {
      this.sessionSockets.set(sessionId, socketId);
    }

    // Map Device
    if (deviceId) {
      this.deviceSockets.set(deviceId, socketId);
    }

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
      const { userId, sessionId, deviceId, driverId } = data;

      if (userId && this.userSockets.has(userId)) {
        const userSet = this.userSockets.get(userId)!;
        userSet.delete(socketId);
        if (userSet.size === 0) {
          this.userSockets.delete(userId);
        }
      }

      if (sessionId && this.sessionSockets.get(sessionId) === socketId) {
        this.sessionSockets.delete(sessionId);
      }

      if (deviceId && this.deviceSockets.get(deviceId) === socketId) {
        this.deviceSockets.delete(deviceId);
      }

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

  getSocketBySessionId(sessionId: string): Socket | undefined {
    const socketId = this.sessionSockets.get(sessionId);
    return socketId ? this.sockets.get(socketId) : undefined;
  }

  getSocketByDeviceId(deviceId: string): Socket | undefined {
    const socketId = this.deviceSockets.get(deviceId);
    return socketId ? this.sockets.get(socketId) : undefined;
  }

  getSocketByDriverId(driverId: string): Socket | undefined {
    const socketId = this.driverSockets.get(driverId);
    return socketId ? this.sockets.get(socketId) : undefined;
  }

  getActiveConnectionCount(): number {
    return this.sockets.size;
  }
}

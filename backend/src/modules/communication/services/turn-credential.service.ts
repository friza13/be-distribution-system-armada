import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface TurnServerCredentials {
  urls: string[];
  username: string;
  credential: string;
  ttlSeconds: number;
}

@Injectable()
export class TurnCredentialService {
  private readonly logger = new Logger(TurnCredentialService.name);
  private readonly turnSecret: string;
  private readonly turnServerUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.turnSecret = this.configService.get<string>(
      'turn.secret',
      'test_turn_secret_min_32_chars_long',
    );
    this.turnServerUrl = this.configService.get<string>(
      'turn.serverUrl',
      'turn:turn.domain.com:3478?transport=udp',
    );
  }

  generateEphemeralCredentials(userId: string, ttlSeconds: number = 3600): TurnServerCredentials {
    const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${timestamp}:${userId}`;

    const hmac = crypto.createHmac('sha1', this.turnSecret);
    hmac.update(username);
    const credential = hmac.digest('base64');

    return {
      urls: [this.turnServerUrl],
      username,
      credential,
      ttlSeconds,
    };
  }
}

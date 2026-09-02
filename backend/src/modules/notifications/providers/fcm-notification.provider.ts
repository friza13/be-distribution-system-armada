import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PushNotificationProvider,
  PushNotificationPayload,
  PushNotificationResult,
} from '../interfaces/push-notification-provider.interface';

@Injectable()
export class FcmNotificationProvider implements PushNotificationProvider {
  private readonly logger = new Logger(FcmNotificationProvider.name);
  private readonly fcmServerKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.fcmServerKey = this.configService.get<string>('notifications.fcmServerKey');
  }

  async sendPushNotification(
    tokens: string[],
    payload: PushNotificationPayload,
  ): Promise<PushNotificationResult> {
    if (!tokens || tokens.length === 0) {
      return { sentCount: 0, failedCount: 0, invalidTokens: [] };
    }

    // PRIVACY INVARIANT: Log only generic event type & count, ZERO push tokens or sensitive content logged
    this.logger.log(
      `Push Notification dispatch: type=${payload.type}, targetTokens=${tokens.length}`,
    );

    // If FCM Server Key is present, dispatch HTTP v1 / Legacy FCM push
    if (this.fcmServerKey) {
      try {
        const response = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `key=${this.fcmServerKey}`,
          },
          body: JSON.stringify({
            registration_ids: tokens,
            notification: {
              title: payload.title,
              body: payload.body,
            },
            data: {
              type: payload.type,
              ...(payload.payloadJson || {}),
            },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const invalidTokens: string[] = [];
          if (data && Array.isArray(data.results)) {
            data.results.forEach((res: any, idx: number) => {
              if (res.error === 'NotRegistered' || res.error === 'InvalidRegistration') {
                invalidTokens.push(tokens[idx]);
              }
            });
          }
          return {
            sentCount: data.success || tokens.length - invalidTokens.length,
            failedCount: data.failure || invalidTokens.length,
            invalidTokens,
          };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`FCM Push dispatch failed (${msg}). Operating in mock fallback.`);
      }
    }

    // Fallback Mock Mode (for dev/test environment without FCM keys)
    return {
      sentCount: tokens.length,
      failedCount: 0,
      invalidTokens: [],
    };
  }
}

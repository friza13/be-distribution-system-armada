export interface PushNotificationPayload {
  title: string;
  body: string;
  type: string;
  payloadJson?: Record<string, any>;
}

export interface PushNotificationResult {
  sentCount: number;
  failedCount: number;
  invalidTokens: string[];
}

export interface PushNotificationProvider {
  sendPushNotification(tokens: string[], payload: PushNotificationPayload): Promise<PushNotificationResult>;
}

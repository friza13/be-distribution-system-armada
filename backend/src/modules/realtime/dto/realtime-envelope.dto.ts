import { v4 as uuidv4 } from 'uuid';

export interface RealtimeEventActor {
  userId: string;
  role: string;
  deviceId?: string;
  driverId?: string | null;
}

export interface RealtimeEventEnvelope<T = unknown> {
  eventId: string;
  event: string;
  version: number;
  timestamp: string;
  correlationId: string;
  actor: RealtimeEventActor;
  payload: T;
}

export function formatRealtimeEvent<T>(
  event: string,
  payload: T,
  actor: RealtimeEventActor,
  correlationId?: string,
): RealtimeEventEnvelope<T> {
  return {
    eventId: uuidv4(),
    event,
    version: 1,
    timestamp: new Date().toISOString(),
    correlationId: correlationId || uuidv4(),
    actor,
    payload,
  };
}

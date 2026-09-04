import {
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsNotEmpty,
  IsString,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OutboxEventItemDto {
  @IsNotEmpty({ message: 'Client event ID is required' })
  @IsString()
  clientEventId: string;

  @IsNotEmpty({ message: 'Event type is required' })
  @IsString()
  eventType: string;

  @IsNotEmpty({ message: 'Occurred timestamp is required' })
  @IsISO8601({}, { message: 'Occurred timestamp must be ISO-8601' })
  occurredAt: string;

  @IsNotEmpty({ message: 'Payload is required' })
  payload: Record<string, any>;

  @IsOptional()
  @IsUUID('4', { message: 'Idempotency key must be a valid UUID' })
  idempotencyKey?: string;
}

export class OutboxSyncDto {
  @IsArray({ message: 'Events must be an array' })
  @ArrayMinSize(1, { message: 'Outbox sync must contain at least 1 event' })
  @ArrayMaxSize(50, { message: 'Outbox sync cannot exceed 50 events' })
  @ValidateNested({ each: true })
  @Type(() => OutboxEventItemDto)
  events: OutboxEventItemDto[];
}

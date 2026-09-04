import {
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { RealtimeSessionType } from '@prisma/client';

export class InitiateCallDto {
  @IsNotEmpty({ message: 'Driver ID is required' })
  @IsUUID('4', { message: 'Driver ID must be a valid UUID' })
  driverId: string;

  @IsNotEmpty({ message: 'Call type is required' })
  @IsEnum(RealtimeSessionType, { message: 'Type must be VOICE_PTT or VIDEO' })
  type: RealtimeSessionType;

  @IsOptional()
  @IsUUID('4', { message: 'Delivery ID must be a valid UUID' })
  deliveryId?: string;
}

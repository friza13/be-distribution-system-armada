import {
  IsNotEmpty,
  IsEnum,
  IsArray,
  IsUUID,
  IsNumber,
  Min,
  IsOptional,
} from 'class-validator';
import { RouteSource } from '@prisma/client';

export class SelectRouteDto {
  @IsNotEmpty({ message: 'Route source is required' })
  @IsEnum(RouteSource, { message: 'Invalid route source enum' })
  source: RouteSource;

  @IsArray({ message: 'Recommended sequence must be an array of deliveryStopIds' })
  @IsUUID('4', { each: true, message: 'Each stop ID in sequence must be a valid UUID' })
  recommendedSequence: string[];

  @IsNotEmpty({ message: 'Total distance in meters is required' })
  @IsNumber({}, { message: 'Total distance must be a number' })
  @Min(0, { message: 'Total distance cannot be negative' })
  totalDistanceMeters: number;

  @IsNotEmpty({ message: 'Estimated duration in seconds is required' })
  @IsNumber({}, { message: 'Estimated duration must be a number' })
  @Min(0, { message: 'Estimated duration cannot be negative' })
  estimatedDurationSeconds: number;

  @IsOptional()
  @IsUUID('4', { message: 'Idempotency key must be a valid UUID' })
  idempotencyKey?: string;
}

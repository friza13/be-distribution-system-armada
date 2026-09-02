import {
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class LocationIngestionDto {
  @IsNotEmpty({ message: 'Latitude is required' })
  @IsNumber({}, { message: 'Latitude must be a number' })
  @Min(-90, { message: 'Latitude must be >= -90' })
  @Max(90, { message: 'Latitude must be <= 90' })
  latitude: number;

  @IsNotEmpty({ message: 'Longitude is required' })
  @IsNumber({}, { message: 'Longitude must be a number' })
  @Min(-180, { message: 'Longitude must be >= -180' })
  @Max(180, { message: 'Longitude must be <= 180' })
  longitude: number;

  @IsNotEmpty({ message: 'Accuracy in meters is required' })
  @IsNumber({}, { message: 'Accuracy must be a number' })
  @Min(0.0001, { message: 'Accuracy must be > 0' })
  @Max(50, { message: 'Accuracy threshold cannot exceed 50 meters' })
  accuracyM: number;

  @IsNotEmpty({ message: 'Recorded timestamp is required' })
  @IsISO8601({}, { message: 'Recorded timestamp must be a valid ISO-8601 string' })
  recordedAt: string;

  @IsOptional()
  @IsNumber({}, { message: 'Speed must be a number' })
  @Min(0, { message: 'Speed cannot be negative' })
  speedMps?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Heading must be a number' })
  @Min(0, { message: 'Heading must be >= 0' })
  @Max(360, { message: 'Heading must be <= 360' })
  headingDeg?: number;

  @IsOptional()
  @IsUUID('4', { message: 'Delivery ID must be a valid UUID' })
  deliveryId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Idempotency Key must be a valid UUID' })
  idempotencyKey?: string;
}

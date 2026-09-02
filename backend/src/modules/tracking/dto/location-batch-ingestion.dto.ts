import {
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LocationIngestionDto } from './location-ingestion.dto';

export class LocationBatchIngestionDto {
  @IsOptional()
  @IsUUID('4', { message: 'Batch Idempotency Key must be a valid UUID' })
  idempotencyKey?: string;

  @IsArray({ message: 'Points must be an array of location objects' })
  @ArrayMinSize(1, { message: 'Batch must contain at least 1 location point' })
  @ArrayMaxSize(50, { message: 'Batch cannot exceed 50 location points' })
  @ValidateNested({ each: true })
  @Type(() => LocationIngestionDto)
  points: LocationIngestionDto[];
}

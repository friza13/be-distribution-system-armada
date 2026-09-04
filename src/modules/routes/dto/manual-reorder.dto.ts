import {
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsUUID,
  IsInt,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StopSequenceItemDto {
  @IsUUID('4', { message: 'Delivery stop ID must be a valid UUID' })
  deliveryStopId: string;

  @IsInt({ message: 'Sequence must be an integer' })
  @Min(1, { message: 'Sequence must be >= 1' })
  sequence: number;
}

export class ManualReorderDto {
  @IsArray({ message: 'Stop sequence must be an array' })
  @ArrayMinSize(1, { message: 'Stop sequence must contain at least 1 item' })
  @ValidateNested({ each: true })
  @Type(() => StopSequenceItemDto)
  stopSequence: StopSequenceItemDto[];

  @IsOptional()
  @IsUUID('4', { message: 'Idempotency key must be a valid UUID' })
  idempotencyKey?: string;
}

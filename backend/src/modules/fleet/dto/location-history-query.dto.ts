import {
  IsNotEmpty,
  IsISO8601,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LocationHistoryQueryDto {
  @IsNotEmpty({ message: 'From timestamp is required' })
  @IsISO8601({}, { message: 'From timestamp must be a valid ISO-8601 string' })
  from: string;

  @IsOptional()
  @IsISO8601({}, { message: 'To timestamp must be a valid ISO-8601 string' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be an integer' })
  @Min(1, { message: 'Limit must be >= 1' })
  @Max(500, { message: 'Limit cannot exceed 500' })
  limit?: number = 100;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Offset must be an integer' })
  @Min(0, { message: 'Offset must be >= 0' })
  offset?: number = 0;
}

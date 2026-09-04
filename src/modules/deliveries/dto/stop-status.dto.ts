import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FailStopDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class SkipStopDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

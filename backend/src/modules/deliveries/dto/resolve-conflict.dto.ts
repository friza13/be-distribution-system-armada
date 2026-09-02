import { IsNotEmpty, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ConflictStatus } from '@prisma/client';

export class ResolveConflictDto {
  @IsNotEmpty({ message: 'Conflict resolution status is required' })
  @IsEnum(ConflictStatus, { message: 'Status must be RESOLVED_OVERRIDDEN or RESOLVED_DISCARDED' })
  status: ConflictStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Resolution notes cannot exceed 1000 characters' })
  resolutionNotes?: string;
}

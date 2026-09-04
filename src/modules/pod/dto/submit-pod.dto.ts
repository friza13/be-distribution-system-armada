import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class SubmitPodDto {
  @IsNotEmpty({ message: 'Receiver name is required' })
  @IsString({ message: 'Receiver name must be a string' })
  @MaxLength(100, { message: 'Receiver name cannot exceed 100 characters' })
  receiverName: string;

  @IsOptional()
  @IsUUID('4', { message: 'Photo file ID must be a valid UUID' })
  photoFileId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Signature file ID must be a valid UUID' })
  signatureFileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Notes cannot exceed 1000 characters' })
  notes?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Idempotency key must be a valid UUID' })
  idempotencyKey?: string;
}

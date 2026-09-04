import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsInt,
  Min,
  IsObject,
  IsOptional,
} from 'class-validator';

export class SendMessageDto {
  @IsNotEmpty({ message: 'Recipient device ID is required' })
  @IsUUID('4', { message: 'Recipient device ID must be a valid UUID' })
  recipientDeviceId: string;

  @IsOptional()
  @IsInt({ message: 'Protocol version must be an integer' })
  @Min(1, { message: 'Protocol version must be >= 1' })
  protocolVersion?: number = 1;

  @IsNotEmpty({ message: 'Ciphertext blob is required' })
  @IsString({ message: 'Ciphertext blob must be a string' })
  ciphertextBlob: string;

  @IsNotEmpty({ message: 'Header JSON is required' })
  @IsObject({ message: 'Header JSON must be an object' })
  headerJson: Record<string, any>;

  @IsOptional()
  @IsUUID('4', { message: 'Idempotency key must be a valid UUID' })
  idempotencyKey?: string;
}

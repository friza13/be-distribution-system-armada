import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelDeliveryDto {
  @IsNotEmpty({ message: 'Cancellation reason is required' })
  @IsString()
  @MaxLength(255)
  reason: string;
}

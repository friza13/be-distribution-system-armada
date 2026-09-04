import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateConversationDto {
  @IsNotEmpty({ message: 'Driver ID is required' })
  @IsUUID('4', { message: 'Driver ID must be a valid UUID' })
  driverId: string;
}

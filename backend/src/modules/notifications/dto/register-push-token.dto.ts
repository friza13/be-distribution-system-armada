import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class RegisterPushTokenDto {
  @IsNotEmpty({ message: 'Device ID is required' })
  @IsUUID('4', { message: 'Device ID must be a valid UUID' })
  deviceId: string;

  @IsNotEmpty({ message: 'Push token is required' })
  @IsString({ message: 'Push token must be a string' })
  pushToken: string;
}

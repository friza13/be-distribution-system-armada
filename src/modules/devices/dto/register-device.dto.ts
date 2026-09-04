import { IsString, IsNotEmpty, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { PlatformType } from '@prisma/client';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceIdentifier: string;

  @IsEnum(PlatformType)
  platform: PlatformType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  appVersion: string;

  @IsOptional()
  @IsString()
  pushToken?: string;
}

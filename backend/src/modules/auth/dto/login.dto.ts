import { IsString, IsNotEmpty, IsOptional, IsEnum, MinLength, MaxLength } from 'class-validator';

export enum ClientType {
  MOBILE = 'MOBILE',
  WEB = 'WEB',
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(100)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(100)
  password: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsEnum(ClientType)
  clientType?: ClientType = ClientType.MOBILE;
}

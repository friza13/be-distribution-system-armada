import { IsUUID, IsString, IsNotEmpty } from 'class-validator';

export class RegisterDeviceKeysDto {
  @IsUUID()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  identityKeyPublic: string;

  @IsString()
  @IsNotEmpty()
  signedPrekeyPublic: string;

  @IsString()
  @IsNotEmpty()
  signedPrekeySig: string;
}

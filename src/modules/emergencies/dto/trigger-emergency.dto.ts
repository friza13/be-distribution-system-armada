import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class TriggerEmergencyDto {
  @IsNotEmpty()
  @IsNumber()
  latitude: number;

  @IsNotEmpty()
  @IsNumber()
  longitude: number;

  @IsNotEmpty()
  @IsString()
  emergencyType: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID('4')
  deliveryId?: string;
}

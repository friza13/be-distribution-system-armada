import {
  IsUUID,
  IsArray,
  ValidateNested,
  IsInt,
  IsString,
  IsNotEmpty,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OneTimePrekeyItemDto {
  @IsInt()
  keyId: number;

  @IsString()
  @IsNotEmpty()
  publicKey: string;
}

export class UploadPrekeysDto {
  @IsUUID()
  @IsNotEmpty()
  deviceId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OneTimePrekeyItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  prekeys: OneTimePrekeyItemDto[];
}

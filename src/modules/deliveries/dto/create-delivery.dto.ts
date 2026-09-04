import {
  IsNotEmpty,
  IsString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsISO8601,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDeliveryItemDto {
  @IsNotEmpty({ message: 'Item code is required' })
  @IsString()
  @MaxLength(50)
  itemCode: string;

  @IsNotEmpty({ message: 'Item name is required' })
  @IsString()
  @MaxLength(100)
  itemName: string;

  @IsNotEmpty({ message: 'Quantity is required' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNotEmpty({ message: 'Unit is required' })
  @IsString()
  @MaxLength(20)
  unit: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  volumeM3?: number;
}

export class CreateDeliveryStopDto {
  @IsNotEmpty({ message: 'Sequence is required' })
  @IsNumber()
  @Min(1)
  sequence: number;

  @IsNotEmpty({ message: 'Destination name is required' })
  @IsString()
  @MaxLength(100)
  destinationName: string;

  @IsNotEmpty({ message: 'Address is required' })
  @IsString()
  address: string;

  @IsNotEmpty({ message: 'Latitude is required' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNotEmpty({ message: 'Longitude is required' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(5000)
  geofenceRadiusM?: number = 100;
}

export class CreateDeliveryDto {
  @IsNotEmpty({ message: 'Delivery code is required' })
  @IsString()
  @MaxLength(50)
  deliveryCode: string;

  @IsOptional()
  @IsISO8601({}, { message: 'Planned start time must be a valid ISO-8601 timestamp' })
  plannedStartAt?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least 1 item is required for a delivery' })
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryItemDto)
  items: CreateDeliveryItemDto[];

  @IsArray()
  @ArrayMinSize(1, { message: 'At least 1 stop destination is required' })
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryStopDto)
  stops: CreateDeliveryStopDto[];
}

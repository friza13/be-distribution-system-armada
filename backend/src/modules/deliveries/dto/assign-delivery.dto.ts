import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignDeliveryDto {
  @IsNotEmpty({ message: 'Driver ID is required' })
  @IsUUID('4', { message: 'Driver ID must be a valid UUID' })
  driverId: string;

  @IsNotEmpty({ message: 'Vehicle ID is required' })
  @IsUUID('4', { message: 'Vehicle ID must be a valid UUID' })
  vehicleId: string;
}

import { IsIn, IsNotEmpty } from 'class-validator';

export class UpdateEmergencyStatusDto {
  @IsNotEmpty()
  @IsIn(['ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM'])
  status: 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_ALARM';
}

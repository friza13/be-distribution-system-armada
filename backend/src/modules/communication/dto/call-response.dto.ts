import { IsNotEmpty, IsIn } from 'class-validator';

export class CallResponseDto {
  @IsNotEmpty({ message: 'Action response is required' })
  @IsIn(['ACCEPT', 'DECLINE'], { message: 'Action must be ACCEPT or DECLINE' })
  action: 'ACCEPT' | 'DECLINE';
}

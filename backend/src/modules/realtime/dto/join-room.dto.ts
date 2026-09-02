import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class JoinRoomDto {
  @IsNotEmpty({ message: 'Room identifier is required' })
  @IsString({ message: 'Room identifier must be a string' })
  @MaxLength(100, { message: 'Room identifier cannot exceed 100 characters' })
  room: string;
}

export class LeaveRoomDto {
  @IsNotEmpty({ message: 'Room identifier is required' })
  @IsString({ message: 'Room identifier must be a string' })
  @MaxLength(100, { message: 'Room identifier cannot exceed 100 characters' })
  room: string;
}

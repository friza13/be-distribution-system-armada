import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(100)
  newPassword: string;
}

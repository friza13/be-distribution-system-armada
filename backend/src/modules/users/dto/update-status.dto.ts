import { IsEnum, IsNotEmpty } from 'class-validator';
import { AccountStatus } from '@prisma/client';

export class UpdateStatusDto {
  @IsEnum(AccountStatus)
  @IsNotEmpty()
  status: AccountStatus;
}

import { IsString, IsIn } from 'class-validator';

export class UpdateBookingStatusDto {
  @IsString()
  @IsIn(['completed', 'noshow'])
  status: string;
}

import { IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  serviceId: string;

  @IsDateString()
  @IsNotEmpty()
  startTime: string; // ISO 8601 UTC string
}

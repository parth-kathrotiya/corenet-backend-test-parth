import { IsUUID, IsNotEmpty, IsString, Matches } from 'class-validator';

export class GetAvailableSlotsDto {
  @IsUUID('4', { message: 'serviceId must be a valid UUID v4' })
  @IsNotEmpty({ message: 'serviceId is required' })
  serviceId: string;

  @IsString()
  @IsNotEmpty({ message: 'date is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  date: string;
}

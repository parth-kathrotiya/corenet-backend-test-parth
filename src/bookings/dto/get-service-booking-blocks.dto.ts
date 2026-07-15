import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class GetServiceBookingBlocksDto {
  @IsString()
  @IsNotEmpty({ message: 'startDate is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format' })
  startDate: string;

  @IsString()
  @IsNotEmpty({ message: 'endDate is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format' })
  endDate: string;
}

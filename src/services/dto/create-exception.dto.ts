import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

export class CreateExceptionDto {
  /** Calendar date: YYYY-MM-DD */
  @IsString()
  @IsNotEmpty()
  date: string;

  /** true = working that day (override hours), false = closed */
  @IsBoolean()
  is_working: boolean;

  /** Required when is_working = true — "HH:MM" */
  @IsOptional()
  @IsString()
  start_time?: string;

  /** Required when is_working = true — "HH:MM" */
  @IsOptional()
  @IsString()
  end_time?: string;
}

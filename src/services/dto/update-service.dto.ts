import { IsString, IsInt, IsNotEmpty, IsArray, ValidateNested, IsBoolean, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

class UpdateAvailabilityDto {
  @IsInt()
  day_of_week: number;

  @IsBoolean()
  is_working: boolean;

  @IsOptional()
  @IsString()
  start_time?: string;

  @IsOptional()
  @IsString()
  end_time?: string;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Service name cannot be empty.' })
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Duration must be at least 1 minute.' })
  duration?: number;

  @IsOptional()
  @IsInt()
  @Min(0, { message: 'Price cannot be negative.' })
  price?: number; // Stored in cents

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateAvailabilityDto)
  availabilities?: UpdateAvailabilityDto[];
}

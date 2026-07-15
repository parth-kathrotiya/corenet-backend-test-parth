import { IsString, IsInt, IsNotEmpty, IsArray, ValidateNested, IsBoolean, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

class AvailabilityDto {
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

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty({ message: 'Service name is required.' })
  name: string;

  @IsInt()
  @Min(1, { message: 'Duration must be at least 1 minute.' })
  duration: number;

  @IsInt()
  @Min(0, { message: 'Price cannot be negative.' })
  price: number; // Stored in cents

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityDto)
  availabilities: AvailabilityDto[];
}

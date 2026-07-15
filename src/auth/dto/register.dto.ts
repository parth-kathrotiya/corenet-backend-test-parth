import { IsEmail, IsIn, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsNotEmpty({ message: 'Email is required.' })
  email: string;

  @MinLength(6, { message: 'Password must be at least 6 characters long.' })
  @IsNotEmpty({ message: 'Password is required.' })
  password: string;

  @IsNotEmpty({ message: 'Name is required.' })
  name: string;

  @IsIn(['owner', 'customer'], { message: 'Role must be either "owner" or "customer".' })
  @IsNotEmpty({ message: 'Role is required.' })
  role: string;
}

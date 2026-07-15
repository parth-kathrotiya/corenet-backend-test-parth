import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/user.decorator';

@Controller('api/bookings')
@UseGuards(JwtGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  /**
   * GET /api/bookings/available-slots?serviceId=&date=YYYY-MM-DD
   * Accessible by customer or owner (any authenticated user).
   */
  @Get('available-slots')
  async getAvailableSlots(
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
  ) {
    return this.bookingsService.getAvailableSlots(serviceId, date);
  }

  /**
   * GET /api/bookings/service/:serviceId/blocks?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   * Returns all booked/blocked slots for a service in a date range.
   */
  @Get('service/:serviceId/blocks')
  async getServiceBookingBlocks(
    @Param('serviceId') serviceId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.bookingsService.getServiceBookingBlocks(serviceId, startDate, endDate);
  }

  /**
   * GET /api/bookings/my  — customer's own upcoming bookings
   * Optional ?serviceId= to filter by a specific service
   */
  @Get('my')
  @Roles('customer')
  async getMyBookings(
    @GetUser('sub') customerId: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.bookingsService.getCustomerBookings(customerId, serviceId);
  }

  /**
   * GET /api/bookings/owner  — upcoming bookings for the logged-in owner
   */
  @Get('owner')
  @Roles('owner')
  async getOwnerBookings(@GetUser('sub') ownerId: string) {
    return this.bookingsService.getOwnerUpcomingBookings(ownerId);
  }

  /**
   * GET /api/bookings/owner/stats  — dashboard stats for logged-in owner
   */
  @Get('owner/stats')
  @Roles('owner')
  async getOwnerStats(@GetUser('sub') ownerId: string) {
    return this.bookingsService.getOwnerStats(ownerId);
  }

  /**
   * POST /api/bookings  — customer creates a booking
   */
  @Post()
  @Roles('customer')
  async createBooking(
    @Body() dto: CreateBookingDto,
    @GetUser('sub') customerId: string,
  ) {
    return this.bookingsService.createBooking(customerId, dto);
  }

  /**
   * PATCH /api/bookings/:id/cancel  — customer cancels their booking
   */
  @Patch(':id/cancel')
  @Roles('customer')
  async cancelBooking(
    @Param('id') id: string,
    @GetUser('sub') customerId: string,
  ) {
    return this.bookingsService.cancelBooking(id, customerId);
  }
}

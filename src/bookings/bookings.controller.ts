import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { GetAvailableSlotsDto } from './dto/get-available-slots.dto';
import { GetServiceBookingBlocksDto } from './dto/get-service-booking-blocks.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/user.decorator';

@Controller('api/bookings')
@UseGuards(JwtGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  /**
   * PATCH /api/bookings/:id/owner-status  — owner sets confirmed|cancelled|completed|noshow
   * Must come before /:id/cancel and /:id/owner-cancel to avoid route conflicts.
   */
  @Patch(':id/owner-status')
  @Roles('owner')
  async updateOwnerBookingStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookingStatusDto,
    @GetUser('sub') ownerId: string,
  ) {
    return this.bookingsService.updateOwnerBookingStatus(id, ownerId, dto.status);
  }

  /**
   * GET /api/bookings/available-slots?serviceId=&date=YYYY-MM-DD
   * Accessible by customer or owner (any authenticated user).
   */
  @Get('available-slots')
  async getAvailableSlots(@Query() query: GetAvailableSlotsDto) {
    return this.bookingsService.getAvailableSlots(query.serviceId, query.date);
  }

  /**
   * GET /api/bookings/service/:serviceId/blocks?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   * Returns all booked/blocked slots for a service in a date range.
   */
  @Get('service/:serviceId/blocks')
  async getServiceBookingBlocks(
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Query() query: GetServiceBookingBlocksDto,
  ) {
    return this.bookingsService.getServiceBookingBlocks(serviceId, query.startDate, query.endDate);
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
   * GET /api/bookings/owner/all  — all bookings (past + future) for the logged-in owner
   */
  @Get('owner/all')
  @Roles('owner')
  async getAllOwnerBookings(@GetUser('sub') ownerId: string) {
    return this.bookingsService.getAllOwnerBookings(ownerId);
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
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('sub') customerId: string,
  ) {
    return this.bookingsService.cancelBooking(id, customerId);
  }

  /**
   * PATCH /api/bookings/:id/owner-cancel  — owner cancels one of their service's bookings
   */
  @Patch(':id/owner-cancel')
  @Roles('owner')
  async cancelOwnerBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('sub') ownerId: string,
  ) {
    return this.bookingsService.cancelOwnerBooking(id, ownerId);
  }
}

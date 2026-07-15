import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Available Slots ────────────────────────────────────────────────────────

  /**
   * Returns an array of available ISO-8601 start-time strings for a given
   * service on a given local calendar date (YYYY-MM-DD).
   *
   * Logic:
   *  1. Look up the service (duration, owner's weekly availability, exceptions).
   *  2. Determine the window for that day:
   *     a. Check availability_exceptions for an exact date match first.
   *     b. Fall back to the regular weekly availability for that day_of_week.
   *  3. Generate a slot grid at [duration]-minute intervals inside the window.
   *  4. Remove slots that overlap with existing confirmed/pending bookings.
   *  5. Remove slots in the past.
   */
  async getAvailableSlots(serviceId: string, date: string): Promise<string[]> {
    // Validate date format
    let dateStr = date;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) {
      if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
        const [d, m, y] = dateStr.split('-');
        dateStr = `${y}-${m}-${d}`;
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const [d, m, y] = dateStr.split('/');
        dateStr = `${y}-${m}-${d}`;
      } else {
        throw new BadRequestException('Date must be in YYYY-MM-DD format.');
      }
    }

    const service = await this.prisma.service.findUnique({
      where: { id: serviceId, deleted_at: null },
      include: {
        availabilities: true,
        exceptions: true,
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    // Parse the date in local calendar terms (treat as UTC midnight for day
    // boundary calculations — the client sends YYYY-MM-DD which is interpreted
    // as a local date).
    const [year, month, day] = dateStr.split('-').map(Number);

    // day_of_week: 0 = Sunday … 6 = Saturday (matching JS Date.getDay())
    const jsDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = jsDate.getUTCDay();

    // ── Step 1: Determine the open window for this date ──────────────────────
    let windowStart: string | null = null;
    let windowEnd: string | null = null;
    let isOpen = false;

    // Check for a specific exception on this date
    const exception = service.exceptions.find((ex) => {
      const exDate = new Date(ex.date);
      return (
        exDate.getUTCFullYear() === year &&
        exDate.getUTCMonth() === month - 1 &&
        exDate.getUTCDate() === day
      );
    });

    if (exception) {
      isOpen = exception.is_working;
      windowStart = exception.start_time;
      windowEnd = exception.end_time;
    } else {
      // Fall back to weekly availability
      const avail = service.availabilities.find(
        (a) => a.day_of_week === dayOfWeek,
      );
      if (avail) {
        isOpen = avail.is_working;
        windowStart = avail.start_time;
        windowEnd = avail.end_time;
      }
    }

    if (!isOpen || !windowStart || !windowEnd) {
      return []; // closed / no availability defined
    }

    // ── Step 2: Generate slot grid ───────────────────────────────────────────
    const slots: Date[] = [];
    const [startHour, startMin] = windowStart.split(':').map(Number);
    const [endHour, endMin] = windowEnd.split(':').map(Number);

    const windowStartMs =
      Date.UTC(year, month - 1, day, startHour, startMin, 0, 0);
    const windowEndMs =
      Date.UTC(year, month - 1, day, endHour, endMin, 0, 0);
    const durationMs = service.duration * 60 * 1000;
    const now = Date.now();

    let cursor = windowStartMs;
    while (cursor + durationMs <= windowEndMs) {
      const slotStart = new Date(cursor);
      // Don't offer slots in the past (with a 15-min buffer)
      if (cursor > now + 15 * 60 * 1000) {
        slots.push(slotStart);
      }
      cursor += durationMs; // slot grid follows service duration
    }

    if (slots.length === 0) return [];

    // ── Step 3: Fetch existing bookings for this day's service ───────────────
    const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const dayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

    const existingBookings = await this.prisma.booking.findMany({
      where: {
        service_id: serviceId,
        status: { in: ['pending', 'confirmed'] },
        start_time: { gte: dayStart, lte: dayEnd },
      },
    });

    // ── Step 4: Filter out conflicting slots ─────────────────────────────────
    const freeSlots = slots.filter((slotStart) => {
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      return !existingBookings.some((bk) => {
        const bkStart = new Date(bk.start_time).getTime();
        const bkEnd = new Date(bk.end_time).getTime();
        return slotStart.getTime() < bkEnd && slotEnd.getTime() > bkStart;
      });
    });

    return freeSlots.map((s) => s.toISOString());
  }

  // ─── Create Booking ──────────────────────────────────────────────────────────

  async createBooking(customerId: string, dto: CreateBookingDto) {
    const { serviceId, startTime } = dto;

    const service = await this.prisma.service.findUnique({
      where: { id: serviceId, deleted_at: null },
      include: { availabilities: true, exceptions: true, owner: true },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    const startDate = new Date(startTime);
    if (isNaN(startDate.getTime())) {
      throw new BadRequestException('Invalid startTime format.');
    }

    // Must be at least 15 minutes in the future
    if (startDate.getTime() <= Date.now() + 15 * 60 * 1000) {
      throw new BadRequestException(
        'Booking must be at least 15 minutes in the future.',
      );
    }

    const endDate = new Date(
      startDate.getTime() + service.duration * 60 * 1000,
    );

    // Verify the slot falls within availability
    const year = startDate.getUTCFullYear();
    const month = startDate.getUTCMonth() + 1;
    const day = startDate.getUTCDate();
    const dayOfWeek = startDate.getUTCDay();

    const exception = service.exceptions.find((ex) => {
      const exDate = new Date(ex.date);
      return (
        exDate.getUTCFullYear() === year &&
        exDate.getUTCMonth() === month - 1 &&
        exDate.getUTCDate() === day
      );
    });

    let isOpen = false;
    let windowStart: string | null = null;
    let windowEnd: string | null = null;

    if (exception) {
      isOpen = exception.is_working;
      windowStart = exception.start_time;
      windowEnd = exception.end_time;
    } else {
      const avail = service.availabilities.find(
        (a) => a.day_of_week === dayOfWeek,
      );
      if (avail) {
        isOpen = avail.is_working;
        windowStart = avail.start_time;
        windowEnd = avail.end_time;
      }
    }

    if (!isOpen || !windowStart || !windowEnd) {
      throw new BadRequestException(
        'Service is not available on the requested date.',
      );
    }

    const [wsH, wsM] = windowStart.split(':').map(Number);
    const [weH, weM] = windowEnd.split(':').map(Number);
    const winStart = Date.UTC(year, month - 1, day, wsH, wsM, 0, 0);
    const winEnd = Date.UTC(year, month - 1, day, weH, weM, 0, 0);

    if (
      startDate.getTime() < winStart ||
      endDate.getTime() > winEnd
    ) {
      throw new BadRequestException(
        'Requested slot is outside service working hours.',
      );
    }

    // ── Step 3: Validate slot alignment ──────────────────────────────────────
    // The requested startTime must fall exactly on a duration-grid boundary starting
    // from the window's start hour. E.g. a 30-min service starting at 09:00 only
    // allows slots at 09:00, 09:30, 10:00 … — NOT at 09:05 or 09:17.
    const [wsH2, wsM2] = windowStart.split(':').map(Number);
    const winStartMs = Date.UTC(year, month - 1, day, wsH2, wsM2, 0, 0);
    const offsetMs = startDate.getTime() - winStartMs;
    const durationMs2 = service.duration * 60 * 1000;
    if (offsetMs < 0 || offsetMs % durationMs2 !== 0) {
      throw new BadRequestException(
        `Slot must align to the ${service.duration}-minute grid starting from ${windowStart}.`,
      );
    }

    // Create booking + notifications in a serializable transaction to prevent double-booking.
    // With Serializable isolation PostgreSQL detects read/write conflicts between concurrent
    // requests for the same slot and aborts one with error code P2034 (caught by HttpExceptionFilter).
    return this.prisma.$transaction(async (tx) => {
      // Check for conflicts (SELECT … FOR UPDATE via serializable TX)
      const conflict = await tx.booking.findFirst({
        where: {
          service_id: serviceId,
          status: { in: ['pending', 'confirmed'] },
          AND: [
            { start_time: { lt: endDate } },
            { end_time: { gt: startDate } },
          ],
        },
      });

      if (conflict) {
        throw new ConflictException(
          'This slot has just been booked. Please choose another time.',
        );
      }

      const booking = await tx.booking.create({
        data: {
          customer_id: customerId,
          service_id: serviceId,
          owner_id: service.owner_id,
          start_time: startDate,
          end_time: endDate,
          status: 'pending',
        },
        include: {
          service: true,
          customer: { select: { name: true, email: true } },
        },
      });

      // Format display time for notifications
      const displayTime = startDate.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      });

      // Notification for Owner — request needs action
      await tx.notification.create({
        data: {
          user_id: service.owner_id,
          title: 'New Booking Request 📋',
          message: `${booking.customer.name} requested "${service.name}" on ${displayTime}. Please confirm or decline.`,
        },
      });

      // Notification for Customer — awaiting confirmation
      await tx.notification.create({
        data: {
          user_id: customerId,
          title: 'Booking Request Sent ⏳',
          message: `Your request for "${service.name}" on ${displayTime} is awaiting owner confirmation.`,
        },
      });

      return booking;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ─── Owner: Update Booking Status ─────────────────────────────────────────

  /**
   * Allows an owner to transition a booking through the allowed states:
   *   pending  → confirmed | cancelled
   *   confirmed (future) → cancelled
   *   confirmed (past)   → completed | noshow
   * A customer notification is sent for every transition.
   */
  async updateOwnerBookingStatus(bookingId: string, ownerId: string, newStatus: string) {
    const ALLOWED_STATUSES = ['confirmed', 'cancelled', 'completed', 'noshow'];
    if (!ALLOWED_STATUSES.includes(newStatus)) {
      throw new BadRequestException(`Invalid status: ${newStatus}.`);
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { service: true, customer: { select: { id: true, name: true } } },
    });

    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.owner_id !== ownerId) {
      throw new ForbiddenException('You cannot update this booking.');
    }

    const now = new Date();
    const bookingTime = new Date(booking.start_time);
    const isPast = bookingTime < now;

    // Define valid next-states per current state
    const validTransitions: Record<string, string[]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: isPast ? ['completed', 'noshow', 'cancelled'] : ['cancelled'],
    };

    const allowed = validTransitions[booking.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition booking from "${booking.status}" to "${newStatus}"` +
          (booking.status === 'confirmed' && !isPast && ['completed', 'noshow'].includes(newStatus)
            ? ' — booking time has not passed yet.'
            : '.'),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: newStatus },
      });

      const displayTime = bookingTime.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      });

      const customerNotifications: Record<string, { title: string; message: string }> = {
        confirmed: {
          title: 'Booking Confirmed ✅',
          message: `Great news! Your booking for "${booking.service.name}" on ${displayTime} has been confirmed.`,
        },
        cancelled: {
          title: 'Booking Cancelled ❌',
          message: `Your booking for "${booking.service.name}" on ${displayTime} has been cancelled by the service provider.`,
        },
        completed: {
          title: 'Appointment Completed 🎉',
          message: `Your appointment for "${booking.service.name}" has been marked as completed. Thank you!`,
        },
        noshow: {
          title: 'Marked as No-show 😔',
          message: `Your appointment for "${booking.service.name}" on ${displayTime} was marked as no-show.`,
        },
      };

      const notif = customerNotifications[newStatus];
      if (notif) {
        await tx.notification.create({
          data: { user_id: booking.customer_id, title: notif.title, message: notif.message },
        });
      }

      return updated;
    });
  }

  // ─── Owner: Upcoming Bookings ─────────────────────────────────────────────

  async getOwnerUpcomingBookings(ownerId: string) {
    const now = new Date();
    return this.prisma.booking.findMany({
      where: {
        owner_id: ownerId,
        status: { in: ['pending', 'confirmed'] },
        start_time: { gte: now },
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        service: { select: { id: true, name: true, duration: true, price: true } },
      },
      orderBy: { start_time: 'asc' },
    });
  }

  // ─── Customer: Cancel Booking ─────────────────────────────────────────────

  async cancelBooking(bookingId: string, customerId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { service: true },
    });

    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.customer_id !== customerId) {
      throw new ForbiddenException('You cannot cancel this booking.');
    }
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new BadRequestException(
        'Only pending or confirmed bookings can be cancelled.',
      );
    }
    if (new Date(booking.start_time) <= new Date()) {
      throw new BadRequestException('Cannot cancel a booking in the past.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'cancelled' },
      });

      // Notify owner
      await tx.notification.create({
        data: {
          user_id: booking.owner_id,
          title: 'Booking Cancelled ❌',
          message: `A customer cancelled their booking for "${booking.service.name}".`,
        },
      });

      return updated;
    });
  }

  // ─── Owner: Stats ─────────────────────────────────────────────────────────

  async getOwnerStats(ownerId: string) {
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
    );
    const todayEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59),
    );
    const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);

    const [todayCount, weekBookings, activeServices, allRevenue] =
      await Promise.all([
        this.prisma.booking.count({
          where: {
            owner_id: ownerId,
            status: { in: ['pending', 'confirmed'] },
            start_time: { gte: todayStart, lte: todayEnd },
          },
        }),
        this.prisma.booking.findMany({
          where: {
            owner_id: ownerId,
            status: { in: ['confirmed', 'completed'] },
            start_time: { gte: weekStart },
          },
          include: { service: { select: { price: true } } },
        }),
        this.prisma.service.count({
          where: { owner_id: ownerId, deleted_at: null },
        }),
        this.prisma.booking.findMany({
          where: {
            owner_id: ownerId,
            status: { in: ['confirmed', 'completed'] },
          },
          include: { service: { select: { price: true } } },
        }),
      ]);

    const weekRevenue = weekBookings.reduce(
      (sum, b) => sum + (b.service?.price ?? 0),
      0,
    );
    const totalRevenue = allRevenue.reduce(
      (sum, b) => sum + (b.service?.price ?? 0),
      0,
    );

    return {
      todayBookings: todayCount,
      weekBookings: weekBookings.length,
      weekRevenue,
      totalRevenue,
      activeServices,
    };
  }

  // ─── Customer: My Upcoming Bookings ───────────────────────────────────────

  /**
   * Returns all upcoming (pending/confirmed) bookings for a customer.
   * Optionally filtered to a specific serviceId.
   */
  async getCustomerBookings(customerId: string, serviceId?: string) {
    return this.prisma.booking.findMany({
      where: {
        customer_id: customerId,
        ...(serviceId ? { service_id: serviceId } : {}),
      },
      include: {
        service: { select: { id: true, name: true, duration: true, price: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
      orderBy: { start_time: 'asc' },
    });
  }

  // ─── Service Booking Blocks ────────────────────────────────────────────────

  /**
   * Returns all booked/blocked slots for a service in a date range.
   */
  async getServiceBookingBlocks(serviceId: string, startDateStr: string, endDateStr: string) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date formats.');
    }
    return this.prisma.booking.findMany({
      where: {
        service_id: serviceId,
        status: { in: ['pending', 'confirmed'] },
        start_time: { gte: start, lte: end },
      },
      select: {
        start_time: true,
        end_time: true,
        status: true,
      },
      orderBy: { start_time: 'asc' },
    });
  }

  // ─── Owner: All Bookings (past + future) ─────────────────────────────────────

  async getAllOwnerBookings(ownerId: string) {
    return this.prisma.booking.findMany({
      where: { owner_id: ownerId },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        service: { select: { id: true, name: true, duration: true, price: true } },
      },
      orderBy: { start_time: 'desc' },
    });
  }

  // ─── Owner: Cancel a Booking ──────────────────────────────────────────────

  async cancelOwnerBooking(bookingId: string, ownerId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { service: true },
    });

    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.owner_id !== ownerId) {
      throw new ForbiddenException('You cannot cancel this booking.');
    }
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new BadRequestException('Only pending or confirmed bookings can be cancelled.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'cancelled' },
      });

      // Notify the customer
      await tx.notification.create({
        data: {
          user_id: booking.customer_id,
          title: 'Booking Cancelled ❌',
          message: `Your booking for "${booking.service.name}" has been cancelled by the service provider.`,
        },
      });

      return updated;
    });
  }
}


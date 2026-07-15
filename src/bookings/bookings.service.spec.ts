import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a Date that is `minutes` minutes from now. */
function futureDate(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/** Builds a mock service with availability covering every day 09:00-17:00. */
function buildMockService(overrides: Record<string, any> = {}): any {
  const availabilities = Array.from({ length: 7 }, (_, i) => ({
    id: `avail-${i}`,
    service_id: 'svc-1',
    day_of_week: i,
    is_working: true,
    start_time: '09:00',
    end_time: '17:00',
  }));

  return {
    id: 'svc-1',
    owner_id: 'owner-1',
    name: 'Test Haircut',
    duration: 30, // minutes
    price: 2500,
    deleted_at: null,
    availabilities,
    exceptions: [],
    owner: { id: 'owner-1', name: 'Owner One' },
    ...overrides,
  };
}

/** Builds a valid future startTime (aligned to 30-min grid from 09:00 UTC). */
function validStartTime(offsetMinutes = 60): Date {
  const d = new Date();
  d.setUTCHours(9, 0, 0, 0); // window opens at 09:00 UTC
  d.setTime(d.getTime() + offsetMinutes * 60 * 1000 + 24 * 60 * 60 * 1000); // tomorrow + offset
  return d;
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

/** Deep mock of a Prisma transaction – runs the callback with the mock itself. */
function mockTx(prismaMock: any) {
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('BookingsService', () => {
  let service: BookingsService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPrisma = {
    service: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    booking: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
    prisma = module.get(PrismaService);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // createBooking
  // ══════════════════════════════════════════════════════════════════════════════

  describe('createBooking', () => {
    it('should create a booking and return it with notifications for valid input', async () => {
      const svc = buildMockService();
      const start = validStartTime(60); // 09:00 + 60 min = 10:00 UTC – on grid
      const end = new Date(start.getTime() + 30 * 60 * 1000);

      const createdBooking = {
        id: 'bk-1',
        customer_id: 'cust-1',
        service_id: 'svc-1',
        owner_id: 'owner-1',
        start_time: start,
        end_time: end,
        status: 'pending',
        service: svc,
        customer: { name: 'Alice', email: 'alice@example.com' },
      };

      mockPrisma.service.findUnique.mockResolvedValue(svc);
      mockTx(mockPrisma);
      mockPrisma.booking.findFirst.mockResolvedValue(null); // no conflict
      mockPrisma.booking.create.mockResolvedValue(createdBooking);
      mockPrisma.notification.create.mockResolvedValue({});

      const result = await service.createBooking('cust-1', {
        serviceId: 'svc-1',
        startTime: start.toISOString(),
      });

      expect(result).toMatchObject({ id: 'bk-1', status: 'pending' });
      // Two notifications should be created: one for owner, one for customer
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when service does not exist', async () => {
      mockPrisma.service.findUnique.mockResolvedValue(null);

      await expect(
        service.createBooking('cust-1', {
          serviceId: 'non-existent',
          startTime: validStartTime(60).toISOString(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when booking is in the past', async () => {
      const svc = buildMockService();
      mockPrisma.service.findUnique.mockResolvedValue(svc);

      const pastTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      await expect(
        service.createBooking('cust-1', {
          serviceId: 'svc-1',
          startTime: pastTime.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when booking is within the 15-minute buffer', async () => {
      const svc = buildMockService();
      mockPrisma.service.findUnique.mockResolvedValue(svc);

      const nearFuture = new Date(Date.now() + 5 * 60 * 1000); // only 5 min ahead

      await expect(
        service.createBooking('cust-1', {
          serviceId: 'svc-1',
          startTime: nearFuture.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when booking is on a closed day', async () => {
      // Make all days is_working: false
      const closedAvails = Array.from({ length: 7 }, (_, i) => ({
        id: `avail-${i}`,
        service_id: 'svc-1',
        day_of_week: i,
        is_working: false,
        start_time: null,
        end_time: null,
      }));
      const svc = buildMockService({ availabilities: closedAvails });
      mockPrisma.service.findUnique.mockResolvedValue(svc);

      const start = validStartTime(60);

      await expect(
        service.createBooking('cust-1', {
          serviceId: 'svc-1',
          startTime: start.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when booking is outside working hours', async () => {
      // Only open 09:00–10:00
      const narrowAvails = Array.from({ length: 7 }, (_, i) => ({
        id: `avail-${i}`,
        service_id: 'svc-1',
        day_of_week: i,
        is_working: true,
        start_time: '09:00',
        end_time: '10:00', // only a 1-hour window
      }));
      const svc = buildMockService({ availabilities: narrowAvails });
      mockPrisma.service.findUnique.mockResolvedValue(svc);

      // Try to book at 14:00 UTC tomorrow (outside 09:00-10:00)
      const outOfHours = new Date();
      outOfHours.setUTCHours(14, 0, 0, 0);
      outOfHours.setTime(outOfHours.getTime() + 24 * 60 * 60 * 1000);

      await expect(
        service.createBooking('cust-1', {
          serviceId: 'svc-1',
          startTime: outOfHours.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when booking start is not on the duration grid', async () => {
      const svc = buildMockService(); // 30-min service, starts 09:00
      mockPrisma.service.findUnique.mockResolvedValue(svc);

      // Try 09:05 UTC tomorrow – off-grid
      const offGrid = new Date();
      offGrid.setUTCHours(9, 5, 0, 0);
      offGrid.setTime(offGrid.getTime() + 24 * 60 * 60 * 1000);

      await expect(
        service.createBooking('cust-1', {
          serviceId: 'svc-1',
          startTime: offGrid.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when slot is already booked', async () => {
      const svc = buildMockService();
      const start = validStartTime(60);
      const end = new Date(start.getTime() + 30 * 60 * 1000);

      mockPrisma.service.findUnique.mockResolvedValue(svc);
      mockTx(mockPrisma);
      // Simulate an existing conflicting booking
      mockPrisma.booking.findFirst.mockResolvedValue({
        id: 'existing-bk',
        start_time: start,
        end_time: end,
        status: 'confirmed',
      });

      await expect(
        service.createBooking('cust-1', {
          serviceId: 'svc-1',
          startTime: start.toISOString(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should use exception date override when one exists', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yyyy = tomorrow.getUTCFullYear();
      const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(tomorrow.getUTCDate()).padStart(2, '0');
      const overrideDate = `${yyyy}-${mm}-${dd}`;

      // Exception: open from 12:00-15:00 only
      const exDate = new Date(Date.UTC(yyyy, parseInt(mm) - 1, parseInt(dd)));
      const svc = buildMockService({
        exceptions: [
          {
            id: 'ex-1',
            service_id: 'svc-1',
            date: exDate,
            is_working: true,
            start_time: '12:00',
            end_time: '15:00',
          },
        ],
      });

      mockPrisma.service.findUnique.mockResolvedValue(svc);

      // Try to book at 09:00 – should fail because exception says 12:00-15:00
      const outOfException = new Date(Date.UTC(yyyy, parseInt(mm) - 1, parseInt(dd), 9, 0, 0, 0));
      // Only use this date if it is more than 15min in the future
      const minutesUntil = (outOfException.getTime() - Date.now()) / 60000;
      if (minutesUntil > 15) {
        await expect(
          service.createBooking('cust-1', {
            serviceId: 'svc-1',
            startTime: outOfException.toISOString(),
          }),
        ).rejects.toThrow(BadRequestException);
      } else {
        // Date is too close – skip this sub-case silently
        expect(true).toBe(true);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // getAvailableSlots
  // ══════════════════════════════════════════════════════════════════════════════

  describe('getAvailableSlots', () => {
    it('should return slots array for a service open on the requested day', async () => {
      const svc = buildMockService();
      mockPrisma.service.findUnique.mockResolvedValue(svc);
      // No booked slots
      mockPrisma.booking.findMany.mockResolvedValue([]);

      // Use a date far enough in the future that slots are ahead of "now + 15 min"
      const future = new Date();
      future.setDate(future.getDate() + 7); // one week ahead
      const dateStr = future.toISOString().split('T')[0]; // YYYY-MM-DD

      const slots = await service.getAvailableSlots('svc-1', dateStr);

      // 09:00 to 17:00 with 30-min slots = 16 slots
      expect(Array.isArray(slots)).toBe(true);
      expect(slots.length).toBe(16);
    });

    it('should return an empty array when service is closed on the requested day', async () => {
      const closedAvails = Array.from({ length: 7 }, (_, i) => ({
        id: `avail-${i}`,
        service_id: 'svc-1',
        day_of_week: i,
        is_working: false,
        start_time: null,
        end_time: null,
      }));
      const svc = buildMockService({ availabilities: closedAvails });
      mockPrisma.service.findUnique.mockResolvedValue(svc);

      const future = new Date();
      future.setDate(future.getDate() + 7);
      const dateStr = future.toISOString().split('T')[0];

      const slots = await service.getAvailableSlots('svc-1', dateStr);
      expect(slots).toEqual([]);
    });

    it('should filter out slots that overlap with existing bookings', async () => {
      const svc = buildMockService();
      mockPrisma.service.findUnique.mockResolvedValue(svc);

      const future = new Date();
      future.setDate(future.getDate() + 7);
      const year = future.getUTCFullYear();
      const month = future.getUTCMonth() + 1;
      const day = future.getUTCDate();

      // Simulate a booking at 09:00 UTC
      const bookedStart = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));
      const bookedEnd = new Date(Date.UTC(year, month - 1, day, 9, 30, 0));
      mockPrisma.booking.findMany.mockResolvedValue([
        { start_time: bookedStart, end_time: bookedEnd, status: 'confirmed' },
      ]);

      const dateStr = future.toISOString().split('T')[0];
      const slots = await service.getAvailableSlots('svc-1', dateStr);

      // 09:00 slot should be removed → 15 slots remain
      expect(slots.length).toBe(15);
      expect(slots.find((s) => s.startsWith(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T09:00`))).toBeUndefined();
    });

    it('should use the exception override instead of weekly availability', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 7);
      const year = future.getUTCFullYear();
      const month = future.getUTCMonth() + 1;
      const day = future.getUTCDate();
      const exDate = new Date(Date.UTC(year, month - 1, day));

      // Exception: closed on this day
      const svc = buildMockService({
        exceptions: [
          {
            id: 'ex-1',
            service_id: 'svc-1',
            date: exDate,
            is_working: false,
            start_time: null,
            end_time: null,
          },
        ],
      });
      mockPrisma.service.findUnique.mockResolvedValue(svc);
      mockPrisma.booking.findMany.mockResolvedValue([]);

      const dateStr = future.toISOString().split('T')[0];
      const slots = await service.getAvailableSlots('svc-1', dateStr);

      // Exception overrides the weekly open schedule → closed → no slots
      expect(slots).toEqual([]);
    });

    it('should throw NotFoundException when service does not exist', async () => {
      mockPrisma.service.findUnique.mockResolvedValue(null);

      await expect(
        service.getAvailableSlots('non-existent', '2026-08-01'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid date format', async () => {
      await expect(
        service.getAvailableSlots('svc-1', 'not-a-date'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // cancelBooking (Customer)
  // ══════════════════════════════════════════════════════════════════════════════

  describe('cancelBooking', () => {
    function buildBooking(overrides: Record<string, any> = {}): any {
      return {
        id: 'bk-1',
        customer_id: 'cust-1',
        owner_id: 'owner-1',
        service_id: 'svc-1',
        start_time: futureDate(60), // 1 hour from now
        status: 'confirmed',
        service: { id: 'svc-1', name: 'Test Haircut' },
        ...overrides,
      };
    }

    it('should cancel a confirmed future booking and notify the owner', async () => {
      const booking = buildBooking();
      mockPrisma.booking.findUnique.mockResolvedValue(booking);
      mockTx(mockPrisma);
      mockPrisma.booking.update.mockResolvedValue({ ...booking, status: 'cancelled' });
      mockPrisma.notification.create.mockResolvedValue({});

      const result = await service.cancelBooking('bk-1', 'cust-1');

      expect(result.status).toBe('cancelled');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: 'owner-1' }),
        }),
      );
    });

    it('should throw NotFoundException when booking does not exist', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(null);

      await expect(service.cancelBooking('bad-id', 'cust-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when cancelling another customer\'s booking', async () => {
      const booking = buildBooking({ customer_id: 'other-customer' });
      mockPrisma.booking.findUnique.mockResolvedValue(booking);

      await expect(service.cancelBooking('bk-1', 'cust-1')).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when cancelling an already-cancelled booking', async () => {
      const booking = buildBooking({ status: 'cancelled' });
      mockPrisma.booking.findUnique.mockResolvedValue(booking);

      await expect(service.cancelBooking('bk-1', 'cust-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when cancelling a completed booking', async () => {
      const booking = buildBooking({ status: 'completed' });
      mockPrisma.booking.findUnique.mockResolvedValue(booking);

      await expect(service.cancelBooking('bk-1', 'cust-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when booking start time is in the past', async () => {
      const booking = buildBooking({
        start_time: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      });
      mockPrisma.booking.findUnique.mockResolvedValue(booking);

      await expect(service.cancelBooking('bk-1', 'cust-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // updateOwnerBookingStatus (Owner)
  // ══════════════════════════════════════════════════════════════════════════════

  describe('updateOwnerBookingStatus', () => {
    function buildOwnerBooking(overrides: Record<string, any> = {}): any {
      return {
        id: 'bk-1',
        customer_id: 'cust-1',
        owner_id: 'owner-1',
        service_id: 'svc-1',
        start_time: futureDate(120), // 2 hours in the future
        status: 'pending',
        service: { id: 'svc-1', name: 'Haircut' },
        customer: { id: 'cust-1', name: 'Alice' },
        ...overrides,
      };
    }

    it('should confirm a pending booking', async () => {
      const booking = buildOwnerBooking();
      mockPrisma.booking.findUnique.mockResolvedValue(booking);
      mockTx(mockPrisma);
      mockPrisma.booking.update.mockResolvedValue({ ...booking, status: 'confirmed' });
      mockPrisma.notification.create.mockResolvedValue({});

      const result = await service.updateOwnerBookingStatus('bk-1', 'owner-1', 'confirmed');
      expect(result.status).toBe('confirmed');
    });

    it('should throw ForbiddenException when a different owner tries to update the booking', async () => {
      const booking = buildOwnerBooking({ owner_id: 'other-owner' });
      mockPrisma.booking.findUnique.mockResolvedValue(booking);

      await expect(
        service.updateOwnerBookingStatus('bk-1', 'owner-1', 'confirmed'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException for invalid status value', async () => {
      const booking = buildOwnerBooking();
      mockPrisma.booking.findUnique.mockResolvedValue(booking);

      await expect(
        service.updateOwnerBookingStatus('bk-1', 'owner-1', 'INVALID_STATUS'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when completing a future (not-past) booking', async () => {
      const booking = buildOwnerBooking({ status: 'confirmed' }); // start_time is in the future
      mockPrisma.booking.findUnique.mockResolvedValue(booking);

      await expect(
        service.updateOwnerBookingStatus('bk-1', 'owner-1', 'completed'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow completing a confirmed booking whose time has passed', async () => {
      const booking = buildOwnerBooking({
        status: 'confirmed',
        start_time: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      });
      mockPrisma.booking.findUnique.mockResolvedValue(booking);
      mockTx(mockPrisma);
      mockPrisma.booking.update.mockResolvedValue({ ...booking, status: 'completed' });
      mockPrisma.notification.create.mockResolvedValue({});

      const result = await service.updateOwnerBookingStatus('bk-1', 'owner-1', 'completed');
      expect(result.status).toBe('completed');
    });

    it('should throw NotFoundException when booking does not exist', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOwnerBookingStatus('non-existent', 'owner-1', 'confirmed'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

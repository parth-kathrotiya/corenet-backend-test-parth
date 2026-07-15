import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CreateExceptionDto } from './dto/create-exception.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createServiceDto: CreateServiceDto, ownerId: string) {
    const { name, duration, price, availabilities } = createServiceDto;

    return this.prisma.$transaction(async (tx) => {
      // Create the service
      const service = await tx.service.create({
        data: {
          name,
          duration,
          price,
          owner_id: ownerId,
        },
      });

      // Create weekly availabilities
      if (availabilities && availabilities.length > 0) {
        await tx.availability.createMany({
          data: availabilities.map((avail) => ({
            service_id: service.id,
            day_of_week: avail.day_of_week,
            is_working: avail.is_working,
            start_time: avail.is_working ? (avail.start_time || '09:00') : null,
            end_time: avail.is_working ? (avail.end_time || '17:00') : null,
          })),
        });
      }

      // Fetch and return the created service with its availabilities
      return tx.service.findUnique({
        where: { id: service.id },
        include: {
          availabilities: {
            orderBy: {
              day_of_week: 'asc',
            },
          },
        },
      });
    });
  }

  async findAll(role: string, userId: string) {
    if (role === 'owner') {
      // Owners only see their own active (non-soft-deleted) services
      return this.prisma.service.findMany({
        where: {
          owner_id: userId,
          deleted_at: null,
        },
        include: {
          availabilities: {
            orderBy: {
              day_of_week: 'asc',
            },
          },
          exceptions: {
            orderBy: {
              date: 'asc',
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      });
    } else {
      // Customers see all active services in the system (with owner name)
      return this.prisma.service.findMany({
        where: {
          deleted_at: null,
        },
        include: {
          availabilities: {
            orderBy: {
              day_of_week: 'asc',
            },
          },
          owner: {
            select: { id: true, name: true },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      });
    }
  }

  async update(id: string, updateServiceDto: UpdateServiceDto, ownerId: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    if (service.owner_id !== ownerId) {
      throw new ForbiddenException('You do not have permission to modify this service.');
    }

    const { name, duration, price, availabilities } = updateServiceDto;

    // Guard: prevent changing service duration when active future bookings exist.
    // Changing duration would shift every slot boundary and make existing confirmed
    // or pending appointments collide with slots the owner would never have offered.
    if (duration !== undefined && duration !== service.duration) {
      const futureBookingCount = await this.prisma.booking.count({
        where: {
          service_id: id,
          status: { in: ['pending', 'confirmed'] },
          start_time: { gte: new Date() },
        },
      });
      if (futureBookingCount > 0) {
        throw new BadRequestException(
          `Cannot change duration: ${futureBookingCount} active future booking(s) exist. ` +
          'Cancel or complete them first.',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Update basic fields
      await tx.service.update({
        where: { id },
        data: {
          name: name !== undefined ? name : undefined,
          duration: duration !== undefined ? duration : undefined,
          price: price !== undefined ? price : undefined,
        },
      });

      // Update weekly availabilities if provided
      if (availabilities !== undefined) {
        // Delete all existing availabilities first
        await tx.availability.deleteMany({
          where: { service_id: id },
        });

        // Recreate them
        if (availabilities.length > 0) {
          await tx.availability.createMany({
            data: availabilities.map((avail) => ({
              service_id: id,
              day_of_week: avail.day_of_week,
              is_working: avail.is_working,
              start_time: avail.is_working ? (avail.start_time || '09:00') : null,
              end_time: avail.is_working ? (avail.end_time || '17:00') : null,
            })),
          });
        }
      }

      // Fetch and return the updated service
      return tx.service.findUnique({
        where: { id },
        include: {
          availabilities: {
            orderBy: {
              day_of_week: 'asc',
            },
          },
        },
      });
    });
  }

  async remove(id: string, ownerId: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    if (service.owner_id !== ownerId) {
      throw new ForbiddenException('You do not have permission to modify this service.');
    }

    // Soft-delete the service
    await this.prisma.service.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      },
    });

    return { id, message: 'Service archived successfully.' };
  }

  // ─── Availability Exception CRUD ───────────────────────────────────────────────

  async getExceptions(serviceId: string, ownerId: string) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found.');
    if (service.owner_id !== ownerId) throw new ForbiddenException('Access denied.');

    return this.prisma.availabilityException.findMany({
      where: { service_id: serviceId },
      orderBy: { date: 'asc' },
    });
  }

  async createException(serviceId: string, ownerId: string, dto: CreateExceptionDto) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found.');
    if (service.owner_id !== ownerId) throw new ForbiddenException('Access denied.');

    let dateStr = dto.date;
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

    if (dto.is_working && (!dto.start_time || !dto.end_time)) {
      throw new BadRequestException('start_time and end_time are required for working exceptions.');
    }

    // Parse date as UTC midnight
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateUTC = new Date(Date.UTC(y, m - 1, d));

    return this.prisma.availabilityException.create({
      data: {
        service_id: serviceId,
        date: dateUTC,
        is_working: dto.is_working,
        start_time: dto.is_working ? (dto.start_time ?? null) : null,
        end_time: dto.is_working ? (dto.end_time ?? null) : null,
      },
    });
  }

  async deleteException(serviceId: string, exceptionId: string, ownerId: string) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found.');
    if (service.owner_id !== ownerId) throw new ForbiddenException('Access denied.');

    const exception = await this.prisma.availabilityException.findUnique({
      where: { id: exceptionId },
    });
    if (!exception || exception.service_id !== serviceId) {
      throw new NotFoundException('Exception not found for this service.');
    }

    await this.prisma.availabilityException.delete({ where: { id: exceptionId } });
    return { id: exceptionId, message: 'Exception removed.' };
  }
}

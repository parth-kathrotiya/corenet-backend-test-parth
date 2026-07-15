import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

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
}

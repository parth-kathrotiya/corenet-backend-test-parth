import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/user.decorator';
import { CreateExceptionDto } from './dto/create-exception.dto';

@Controller('api/services')
@UseGuards(JwtGuard, RolesGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @Roles('owner')
  async create(
    @Body() createServiceDto: CreateServiceDto,
    @GetUser('sub') ownerId: string,
  ) {
    return this.servicesService.create(createServiceDto, ownerId);
  }

  @Get()
  async findAll(
    @GetUser('role') role: string,
    @GetUser('sub') userId: string,
  ) {
    return this.servicesService.findAll(role, userId);
  }

  @Patch(':id')
  @Roles('owner')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServiceDto: UpdateServiceDto,
    @GetUser('sub') ownerId: string,
  ) {
    return this.servicesService.update(id, updateServiceDto, ownerId);
  }

  @Delete(':id')
  @Roles('owner')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('sub') ownerId: string,
  ) {
    return this.servicesService.remove(id, ownerId);
  }

  // ─── Availability Exceptions ─────────────────────────────────────────────

  @Get(':id/exceptions')
  @Roles('owner')
  async getExceptions(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('sub') ownerId: string,
  ) {
    return this.servicesService.getExceptions(id, ownerId);
  }

  @Post(':id/exceptions')
  @Roles('owner')
  async createException(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExceptionDto,
    @GetUser('sub') ownerId: string,
  ) {
    return this.servicesService.createException(id, ownerId, dto);
  }

  @Delete(':id/exceptions/:exId')
  @Roles('owner')
  async deleteException(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('exId', ParseUUIDPipe) exId: string,
    @GetUser('sub') ownerId: string,
  ) {
    return this.servicesService.deleteException(id, exId, ownerId);
  }
}

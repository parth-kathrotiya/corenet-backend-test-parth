import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { GetUser } from '../auth/decorators/user.decorator';

@Controller('api/notifications')
@UseGuards(JwtGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(@GetUser('sub') userId: string) {
    return this.notificationsService.getUserNotifications(userId);
  }

  @Get('unread-count')
  async getUnreadCount(@GetUser('sub') userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch('read-all')
  async markAllRead(@GetUser('sub') userId: string) {
    return this.notificationsService.markAllRead(userId);
  }

  @Patch(':id/read')
  async markOneRead(
    @Param('id') id: string,
    @GetUser('sub') userId: string,
  ) {
    return this.notificationsService.markOneRead(id, userId);
  }
}

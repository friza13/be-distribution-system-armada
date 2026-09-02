import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('deliveries')
@UseGuards(AuthGuard('jwt'))
export class DeliveriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async getDelivery(@Param('id') id: string, @Req() req: any) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: { driver: true, stops: true },
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    // OBJECT-LEVEL AUTHORIZATION (IDOR Defense)
    if (req.user.role === 'DRIVER') {
      if (delivery.driverId !== req.user.driverId) {
        throw new ForbiddenException({
          code: 'RESOURCE_FORBIDDEN',
          message: 'You are not assigned to this delivery',
        });
      }
    }

    return delivery;
  }
}

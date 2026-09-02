import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('liveness')
  getLiveness() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}

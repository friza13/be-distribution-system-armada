import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, ClientType } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { generateSecureToken } from '../../common/utils/token.util';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('csrf')
  getCsrfToken(@Res({ passthrough: true }) res: Response) {
    const csrfToken = generateSecureToken(24);
    res.cookie('dms_csrf_token', csrfToken, {
      httpOnly: false, // Read by JS to place in x-csrf-token header
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });
    return { csrfToken };
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp = req.ip || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return this.authService.login(dto, clientIp, userAgent, res);
  }

  @Post('refresh')
  @UseGuards(CsrfGuard)
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-client-type') headerClientType?: string,
  ) {
    const cookieToken = req.cookies?.['dms_refresh_token'];
    const rawToken = dto.refreshToken || cookieToken;
    const clientType = cookieToken || headerClientType === 'WEB' ? ClientType.WEB : ClientType.MOBILE;

    return this.authService.refresh(rawToken, clientType, res);
  }

  @Post('register')
  async register(@Body() dto: RegisterUserDto) {
    return this.authService.registerUser(dto);
  }

  @Post('logout')
  @UseGuards(CsrfGuard)
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionId = req.user?.sessionId;
    const userId = req.user?.id;
    return this.authService.logout(sessionId, userId, res);
  }

  @Post('logout-all')
  @UseGuards(CsrfGuard)
  async logoutAll(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = req.user?.id;
    return this.authService.logoutAll(userId, res);
  }
}

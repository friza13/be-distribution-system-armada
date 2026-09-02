import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(private readonly configService: ConfigService) {
    const origins = this.configService.get<string[]>('cors.allowedOrigins', []);
    this.allowedOrigins = new Set(origins.map((o) => o.trim().toLowerCase()));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    
    // If request is from Mobile Client (Bearer token in header), CSRF does not apply
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return true;
    }

    const clientType = request.headers['x-client-type'];
    const hasRefreshCookie = Boolean(request.cookies?.['dms_refresh_token']);

    // If request is using Cookie-based Web Auth or explicit Web client
    if (hasRefreshCookie || clientType === 'WEB') {
      // 1. Validate Origin / Referer against allowed origins
      const origin = request.headers['origin'];
      const referer = request.headers['referer'];
      const targetHeader = origin || referer;

      if (!targetHeader) {
        throw new ForbiddenException('CSRF_ORIGIN_REQUIRED: Missing Origin or Referer header');
      }

      const parsedOrigin = new URL(targetHeader).origin.toLowerCase();
      if (!this.allowedOrigins.has(parsedOrigin)) {
        throw new ForbiddenException(`CSRF_ORIGIN_DENIED: Untrusted origin ${parsedOrigin}`);
      }

      // 2. Validate Double Submit CSRF Token
      const headerCsrf = request.headers['x-csrf-token'];
      const cookieCsrf = request.cookies?.['dms_csrf_token'];

      if (!headerCsrf || !cookieCsrf || headerCsrf !== cookieCsrf) {
        throw new ForbiddenException('CSRF_TOKEN_MISMATCH: Invalid or missing CSRF token');
      }
    }

    return true;
  }
}

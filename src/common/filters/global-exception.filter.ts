import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse, ApiErrorDetail } from '../dto/api-response.dto';
import { sanitizeLogData } from '../utils/log-sanitizer.util';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.id || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let errorMessage = 'An internal server error occurred';
    let errorDetails: Record<string, unknown> | Array<unknown> | string | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      errorCode = HttpStatus[status] || 'HTTP_EXCEPTION';

      if (typeof res === 'string') {
        errorMessage = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        errorMessage = (resObj.message as string) || exception.message;
        if (resObj.code && typeof resObj.code === 'string') {
          errorCode = resObj.code;
        }
        if (Array.isArray(resObj.message)) {
          errorMessage = 'Validation failed';
          errorDetails = resObj.message;
          errorCode = 'VALIDATION_ERROR';
        }
      }
    } else {
      // Unhandled / Internal DB / Driver error -> MASK IT to prevent Information Disclosure
      const sanitizedException = sanitizeLogData(
        exception instanceof Error
          ? { message: exception.message, stack: exception.stack }
          : exception,
      );
      this.logger.error(
        `Unhandled Exception [${requestId}]: ${JSON.stringify(sanitizedException)}`,
      );
    }

    const errorPayload: ApiErrorDetail = {
      code: errorCode,
      message: errorMessage,
      ...(errorDetails ? { details: errorDetails } : {}),
    };

    const envelope = ApiResponse.error(errorPayload, requestId);
    response.status(status).json(envelope);
  }
}

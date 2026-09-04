import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incomingId = req.headers['x-request-id'];
    let requestId: string;

    if (
      typeof incomingId === 'string' &&
      incomingId.length === 36 &&
      UUID_REGEX.test(incomingId)
    ) {
      requestId = incomingId;
    } else {
      requestId = uuidv4();
    }

    req.id = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}

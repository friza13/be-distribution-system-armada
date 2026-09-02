# Phase 0: Foundation, Arsitektur Modul & Resource Limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun fondasi codebase backend NestJS (modular monolith) berbasis **Node.js 22 LTS**, environment configuration & validation (termasuk generic JWT configuration contract), hardened UUID correlation ID middleware, standard API envelope tanpa `any`, sanitized global exception filter, DTO whitelisting anti mass-assignment, request body limits, local PostGIS/Redis docker environment dengan zero plaintext secrets, serta mengeksekusi ORM Selection Spike (ADR-001) di folder `spikes/orm/`.

**Architecture:** Modular Monolith NestJS dengan strict TypeScript (`strictNullChecks`, `noImplicitAny`), declarative validation pipes (`class-validator`), central exception filter dengan log sanitization, correlation tracking terproteksi regex UUID, dan layered domain modules terisolasi di `backend/src/modules/`.

**Tech Stack:** Node.js 22 LTS, NestJS 10.x, TypeScript 5.x, class-validator, class-transformer, Joi config validator, Jest, Docker Compose (PostgreSQL 16 + PostGIS 3.4, Redis 7).

---

## Global Constraints

- **Node.js Runtime Baseline:** `Node.js 22 LTS (Active LTS)` (wajib konsisten pada package engine dan Dockerfile).
- **Backend directory root:** `backend/`
- **Package manager:** `npm` (dengan `package-lock.json`).
- **Global API Prefix:** `v1` (semua route diakses via `/v1/*`).
- **Zero Plaintext Secrets:** Docker Compose dan aplikasi backend hanya membaca credentials via env substitution (`.env.example` hanya berisi template).
- **Strict DTO whitelisting:** `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`.
- **Global JSON body size limit:** `100kb`.
- **Standard API Envelope:** `{ success, data, error, timestamp, requestId }` (zero `any` types).
- **Performance Formulation:** Semua angka performa di Phase 0 adalah **Measurement Baseline Targets**.

---

## File Structure Map

```text
backend/
├── src/
│   ├── common/
│   │   ├── dto/
│   │   │   ├── api-response.dto.ts
│   │   │   └── pagination.dto.ts
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts
│   │   ├── interceptors/
│   │   │   ├── transform.interceptor.ts
│   │   │   └── logging.interceptor.ts
│   │   ├── middleware/
│   │   │   └── request-id.middleware.ts
│   │   └── utils/
│   │       └── log-sanitizer.util.ts
│   ├── config/
│   │   ├── configuration.ts
│   │   └── env.validation.ts
│   ├── modules/
│   │   └── health/
│   │       ├── health.controller.ts
│   │       └── health.module.ts
│   ├── app.module.ts
│   └── main.ts
├── spikes/
│   └── orm/
│       ├── orm-evaluation.ts
│       └── README.md
├── test/
│   ├── api-envelope.e2e-spec.ts
│   ├── correlation-id.e2e-spec.ts
│   ├── mass-assignment.e2e-spec.ts
│   ├── request-limits.e2e-spec.ts
│   └── jest-e2e.json
├── docs/
│   └── adr/
│       └── ADR-001-ORM-SELECTION.md
├── .env.example
├── .gitignore
├── docker-compose.yml
├── nest-cli.json
├── package.json
└── tsconfig.json
```

---

## Task Breakdown & Bite-Sized Steps

---

### Task 0.1: Repository Scaffolding, TypeScript Config & Zero-Secret Docker Environment (`BE-CORE-001`)

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/tsconfig.build.json`
- Create: `backend/nest-cli.json`
- Create: `backend/.gitignore`
- Create: `backend/.env.example`
- Create: `backend/docker-compose.yml`
- Create: `backend/src/config/configuration.ts`
- Create: `backend/src/config/env.validation.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/main.ts`

**Interfaces:**
- Consumes: Environment variables (`PORT`, `NODE_ENV`, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `JWT_ALGORITHM`, `JWT_SECRET_OR_KEY`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_EXPIRATION`)
- Produces: Bootstrapped NestJS App instance on `http://localhost:3000`

- [ ] **Step 1: Inisialisasi package.json dengan Node 22 LTS engine constraint**

```json
{
  "name": "distribution-system-backend",
  "version": "1.0.0",
  "description": "Distribution Management System Backend API",
  "author": "Capstone Team BE & Security",
  "private": true,
  "license": "UNLICENSED",
  "engines": {
    "node": ">=22.0.0 <23.0.0",
    "npm": ">=10.0.0"
  },
  "scripts": {
    "build": "nest build",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\" \"spikes/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,test,spikes}/**/*.ts\" --fix",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "spike:orm": "ts-node spikes/orm/orm-evaluation.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/config": "^3.2.3",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/swagger": "^7.4.0",
    "@nestjs/terminus": "^10.2.3",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "joi": "^17.13.3",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.0",
    "@nestjs/schematics": "^10.1.4",
    "@nestjs/testing": "^10.4.0",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^22.5.0",
    "@types/supertest": "^6.0.2",
    "@types/uuid": "^10.0.0",
    "jest": "^29.7.0",
    "source-map-support": "^0.5.21",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.4",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Setup .gitignore, .env.example, dan docker-compose.yml dengan env substitution**

Buat `backend/.gitignore`:
```text
# Node dependencies
node_modules/
npm-debug.log*

# Build outputs
dist/
build/
coverage/

# Environment and Secrets (CRITICAL: Zero secrets in repo)
.env
.env.local
.env.*.local
*.pem
*.key
*.cert

# IDE and OS files
.DS_Store
.idea/
.vscode/
*.swp
```

Buat `backend/.env.example`:
```bash
# Application Configuration
NODE_ENV=development
PORT=3000
API_PREFIX=v1

# PostgreSQL + PostGIS (Dev Database)
POSTGRES_DB=distribution_db
POSTGRES_USER=dms_user
POSTGRES_PASSWORD=your_secure_postgres_password_here
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Configuration Contract (Algorithm choice formalized in ADR-004)
JWT_ALGORITHM=HS256
JWT_SECRET_OR_KEY=your_minimum_32_characters_random_secret_string_here
JWT_ISSUER=dms-api
JWT_AUDIENCE=dms-clients
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# CORS Allowed Origins (Comma separated)
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

Buat `backend/docker-compose.yml`:
```yaml
version: '3.8'

services:
  postgres:
    image: postgis/postgis:16-3.4-alpine
    container_name: dms_postgres_dev
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-distribution_db}
      POSTGRES_USER: ${POSTGRES_USER:-dms_user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Error: POSTGRES_PASSWORD is required in .env}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-dms_user} -d ${POSTGRES_DB:-distribution_db}"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: dms_redis_dev
    restart: unless-stopped
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

- [ ] **Step 3: Setup Environment Validation & Configuration Service**

Buat `backend/src/config/env.validation.ts`:
```typescript
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('v1'),
  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  JWT_ALGORITHM: Joi.string().valid('HS256', 'RS256', 'EdDSA').default('HS256'),
  JWT_SECRET_OR_KEY: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().default('dms-api'),
  JWT_AUDIENCE: Joi.string().default('dms-clients'),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000,http://localhost:5173'),
});
```

Buat `backend/src/config/configuration.ts`:
```typescript
export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'v1',
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  jwt: {
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    secretOrKey: process.env.JWT_SECRET_OR_KEY,
    issuer: process.env.JWT_ISSUER || 'dms-api',
    audience: process.env.JWT_AUDIENCE || 'dms-clients',
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },
  cors: {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '').split(','),
  },
});
```

- [ ] **Step 4: Install dependencies & verify compile**

Run: `cd backend && npm install && npm run build`  
Expected: Build sukses, folder `dist/` terbentuk tanpa TypeScript error.

---

### Task 0.2: Standard API Envelope, Hardened Correlation ID & Sanitized Global Exception Filter (`BE-CORE-002`)

**Files:**
- Create: `backend/src/common/dto/api-response.dto.ts`
- Create: `backend/src/common/utils/log-sanitizer.util.ts`
- Create: `backend/src/common/middleware/request-id.middleware.ts`
- Create: `backend/src/common/interceptors/transform.interceptor.ts`
- Create: `backend/src/common/filters/global-exception.filter.ts`
- Create: `backend/src/modules/health/health.controller.ts`
- Create: `backend/src/modules/health/health.module.ts`
- Create: `backend/test/api-envelope.e2e-spec.ts`
- Create: `backend/test/correlation-id.e2e-spec.ts`

**Interfaces:**
- Produces: Standard Response Envelope `{ success, data, error, timestamp, requestId }` (zero `any` types).
- Hardened: Rejects malformed `x-request-id` with strict UUID regex validation.
- Sanitized: Redacts all sensitive keys (`password`, `token`, `secret`, `authorization`) in server logs.

- [ ] **Step 1: Tulis Failing Tests (API Envelope & Correlation ID Validation)**

Buat `backend/test/correlation-id.e2e-spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Correlation ID Middleware Hardening (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should accept valid UUID x-request-id and echo back', async () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const res = await request(app.getHttpServer())
      .get('/v1/health/liveness')
      .set('x-request-id', validUuid)
      .expect(HttpStatus.OK);

    expect(res.headers['x-request-id']).toBe(validUuid);
    expect(res.body.requestId).toBe(validUuid);
  });

  it('should discard invalid/arbitrary x-request-id and generate fresh UUID', async () => {
    const invalidId = 'malicious_header_injection_attempt_123456789';
    const res = await request(app.getHttpServer())
      .get('/v1/health/liveness')
      .set('x-request-id', invalidId)
      .expect(HttpStatus.OK);

    expect(res.headers['x-request-id']).not.toBe(invalidId);
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
```

- [ ] **Step 2: Implementasikan Log Sanitizer Utility & Hardened Request ID Middleware**

Buat `backend/src/common/utils/log-sanitizer.util.ts`:
```typescript
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'authorization',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'key',
  'privatekey',
  'cookie',
  'databaseurl',
  'postgres_password',
]);

export function sanitizeLogData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  if (typeof data === 'object') {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitizedObj[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitizedObj[key] = sanitizeLogData(value);
      } else {
        sanitizedObj[key] = value;
      }
    }
    return sanitizedObj;
  }

  return data;
}
```

Buat `backend/src/common/middleware/request-id.middleware.ts`:
```typescript
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

    if (typeof incomingId === 'string' && incomingId.length === 36 && UUID_REGEX.test(incomingId)) {
      requestId = incomingId;
    } else {
      requestId = uuidv4();
    }

    req.id = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}
```

Buat `backend/src/common/dto/api-response.dto.ts` (Zero `any`):
```typescript
export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: Record<string, unknown> | Array<unknown> | string | null;
}

export class ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorDetail | null;
  timestamp: string;
  requestId: string;

  constructor(success: boolean, data: T | null, error: ApiErrorDetail | null, requestId: string) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.timestamp = new Date().toISOString();
    this.requestId = requestId;
  }

  static success<T>(data: T, requestId: string): ApiResponse<T> {
    return new ApiResponse<T>(true, data, null, requestId);
  }

  static error(error: ApiErrorDetail, requestId: string): ApiResponse<null> {
    return new ApiResponse<null>(false, null, error, requestId);
  }
}
```

Buat `backend/src/common/filters/global-exception.filter.ts` (dengan sanitized logging):
```typescript
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
        if (Array.isArray(resObj.message)) {
          errorMessage = 'Validation failed';
          errorDetails = resObj.message;
          errorCode = 'VALIDATION_ERROR';
        }
      }
    } else {
      // Unhandled / Internal DB / Driver error -> MASK IT to prevent Information Disclosure
      const sanitizedException = sanitizeLogData(
        exception instanceof Error ? { message: exception.message, stack: exception.stack } : exception,
      );
      this.logger.error(`Unhandled Exception [${requestId}]: ${JSON.stringify(sanitizedException)}`);
    }

    const errorPayload: ApiErrorDetail = {
      code: errorCode,
      message: errorMessage,
      ...(errorDetails ? { details: errorDetails } : {}),
    };

    response.status(status).json(ApiResponse.error(errorPayload, requestId));
  }
}
```

- [ ] **Step 3: Jalankan E2E tests dan pastikan PASS**

Run: `cd backend && npm run test:e2e`  
Expected: PASS.

---

### Task 0.3: Global Request Limits, DTO Whitelisting & Base Pagination (`BE-CORE-004`)

**Files:**
- Create: `backend/src/common/dto/pagination.dto.ts`
- Modify: `backend/src/main.ts`
- Create: `backend/test/mass-assignment.e2e-spec.ts`
- Create: `backend/test/request-limits.e2e-spec.ts`

- [ ] **Step 1: Tulis Failing Test Mass Assignment & Request Limits**

Buat `backend/test/mass-assignment.e2e-spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, Controller, Post, Body, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { IsString, IsNotEmpty } from 'class-validator';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

class TestCreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

@Controller('test-users')
class TestUsersController {
  @Post()
  create(@Body() dto: TestCreateUserDto) {
    return { created: true, user: dto };
  }
}

describe('Mass Assignment Protection (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TestUsersController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should accept valid DTO without extra properties', async () => {
    await request(app.getHttpServer())
      .post('/test-users')
      .send({ name: 'John Doe' })
      .expect(HttpStatus.CREATED);
  });

  it('should reject request with forbidden unwhitelisted property (role injection)', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-users')
      .send({ name: 'John Doe', role: 'ADMIN' })
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('property role should not exist');
  });
});
```

- [ ] **Step 2: Implementasikan Base Pagination DTO & Konfigurasi Main.ts**

Buat `backend/src/common/dto/pagination.dto.ts`:
```typescript
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}
```

Update `backend/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as express from 'express';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Request limits
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '50kb' }));

  // Global Correlation ID
  app.use(new RequestIdMiddleware().use);

  // Global API Prefix
  app.setGlobalPrefix('v1');

  // Global Validation Pipe (Anti Mass-Assignment)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Global Exception & Transform Interceptors
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Distribution System Backend API is running on port ${port}`);
}
bootstrap();
```

- [ ] **Step 3: Jalankan test dan pastikan PASS**

Run: `cd backend && npm run test`  
Expected: PASS.

---

### Task 0.4: ORM & PostGIS Spike Evaluation & Decision Record (`BE-CORE-003` / `ADR-001`)

**Files:**
- Create: `backend/spikes/orm/orm-evaluation.ts`
- Create: `backend/spikes/orm/README.md`
- Create: `docs/adr/ADR-001-ORM-SELECTION.md` (Initial status: `PROPOSED`, updated to `ACCEPTED` with empirical data)

- [ ] **Step 1: Buat prototype script pengujian PostGIS di `backend/spikes/orm/`**

Uji fungsionalitas spasial:
- DDL skema: tabel dengan kolom `geometry(Point, 4326)`
- Insert 1000 record koordinat
- Query spasial: `ST_DWithin`, `ST_Distance`
- Evaluasi tooling migrasi (Prisma vs Drizzle vs TypeORM).

- [ ] **Step 2: Susun Dokumen Keputusan `docs/adr/ADR-001-ORM-SELECTION.md`**

Struktur ADR:
- **Title:** ADR-001: ORM & Database Migration Engine Selection for PostgreSQL + PostGIS
- **Status:** `PROPOSED` (saat inisiasi) $\rightarrow$ `ACCEPTED` (setelah benchmark)
- **Context:** Kebutuhan sistem spasial, transaksi ACID delivery, dan batasan memori staging 2 GB RAM.
- **Decision & Benchmark Evidence:** Menyertakan hasil uji spatial query latency dan kemudahan migrasi.

---

## Verification Plan

### Automated Tests
```bash
# 1. Jalankan Unit Tests
cd backend && npm run test

# 2. Jalankan E2E Integration & Security Tests
cd backend && npm run test:e2e

# 3. Jalankan Build Verification
cd backend && npm run build
```

### Manual Verification
1. Boot container PostGIS & Redis: `cd backend && docker compose up -d`
2. Jalankan backend: `cd backend && npm run start:dev`
3. Request test: `curl -i http://localhost:3000/v1/health/liveness`
   - Pastikan header `x-request-id` berformat UUID valid.
   - Pastikan body berformat `{ success: true, data: { status: "ok" }, error: null, timestamp: "...", requestId: "..." }`.
4. Test payload besar: `curl -X POST http://localhost:3000/v1/health/liveness -H "Content-Type: application/json" -d @large_payload.json` $\rightarrow$ verify HTTP 413.
5. Matikan container: `docker compose down`

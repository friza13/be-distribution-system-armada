process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://dms_user:secret@localhost:5432/distribution_db';
process.env.JWT_SECRET_OR_KEY = 'test_secret_with_minimum_32_characters_length_here';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

describe('Correlation ID Middleware Hardening (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
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

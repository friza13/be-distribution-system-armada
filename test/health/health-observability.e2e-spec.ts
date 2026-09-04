import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';

describe('Health & Readiness Observability API (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return process uptime on Liveness Probe (GET /v1/health/liveness)', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/health/liveness')
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.uptime).toBeGreaterThan(0);
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('should return 200 OK with deep health indicators on Readiness Probe (GET /v1/health/readiness)', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/health/readiness')
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.info.database.status).toBe('up');
    expect(res.body.data.info.redis.status).toBe('up');
    expect(res.body.data.info.storage.status).toBe('up');
    expect(res.body.data.info.memory_heap.status).toBe('up');
  });
});

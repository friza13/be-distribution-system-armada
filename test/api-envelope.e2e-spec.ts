import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

describe('Standard API Envelope & Exception Filter (E2E)', () => {
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

  it('GET /v1/health/liveness should return success standard envelope with requestId', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/health/liveness')
      .expect(HttpStatus.OK);

    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('error', null);
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('requestId');
    expect(response.headers).toHaveProperty('x-request-id');
  });

  it('GET /v1/non-existent-route should return structured 404 error envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/non-existent-route')
      .expect(HttpStatus.NOT_FOUND);

    expect(response.body).toHaveProperty('success', false);
    expect(response.body).toHaveProperty('data', null);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
    expect(response.body).toHaveProperty('requestId');
  });
});

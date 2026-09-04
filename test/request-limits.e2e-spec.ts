import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Controller, Post, Body, HttpStatus } from '@nestjs/common';
import * as express from 'express';
import * as request from 'supertest';

@Controller('test-body')
class TestBodyController {
  @Post()
  receiveBody(@Body() body: any) {
    return { receivedLength: Object.keys(body).length };
  }
}

describe('Request Body Limit Enforcement (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TestBodyController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(express.json({ limit: '100kb' }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should accept JSON body under 100kb', async () => {
    const smallPayload = { message: 'hello world' };
    await request(app.getHttpServer())
      .post('/test-body')
      .send(smallPayload)
      .expect(HttpStatus.CREATED);
  });

  it('should reject JSON body exceeding 100kb with HTTP 413 Payload Too Large', async () => {
    const largeString = 'A'.repeat(120 * 1024); // 120 KB
    await request(app.getHttpServer())
      .post('/test-body')
      .send({ bigData: largeString })
      .expect(HttpStatus.PAYLOAD_TOO_LARGE);
  });
});

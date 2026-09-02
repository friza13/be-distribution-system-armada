import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  Controller,
  Post,
  Body,
  HttpStatus,
} from '@nestjs/common';
import * as request from 'supertest';
import { IsString, IsNotEmpty } from 'class-validator';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

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

describe('Mass Assignment & DTO Whitelist (E2E)', () => {
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
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should accept valid DTO payload without unwhitelisted properties', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-users')
      .send({ name: 'Valid User' })
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.name).toBe('Valid User');
  });

  it('should reject payload containing injected/forbidden fields (role: ADMIN)', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-users')
      .send({ name: 'Attacker', role: 'ADMIN' })
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain(
      'property role should not exist',
    );
  });
});

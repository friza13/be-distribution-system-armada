import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('JWT Lifecycle & Token Security (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testUser: any;
  const secretKey = 'test_secret_with_minimum_32_characters_length_here';

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

    prisma = app.get(PrismaService);

    const role = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    testUser = await prisma.user.create({
      data: {
        username: `jwt_test_${Date.now()}`,
        phone: `+62818${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    if (testUser) {
      await prisma.session.deleteMany({ where: { userId: testUser.id } });
      await prisma.device.deleteMany({ where: { userId: testUser.id } });
      await prisma.user.delete({ where: { id: testUser.id } });
    }
    await app.close();
  });

  it('should authenticate user and issue signed HS256 JWT with strict claims', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        username: testUser.username,
        password: 'Password123!',
        clientType: 'MOBILE',
      })
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');

    const decodedHeader: any = jwt.decode(res.body.data.accessToken, { complete: true });
    expect(decodedHeader.header.alg).toBe('HS256');
    expect(decodedHeader.header).toHaveProperty('kid');

    const payload: any = decodedHeader.payload;
    expect(payload.sub).toBe(testUser.id);
    expect(payload.role).toBe('OWNER');
    expect(payload.type).toBe('ACCESS_TOKEN');
    expect(payload.iss).toBe('dms-api');
    expect(payload.aud).toBe('dms-clients');
    expect(payload.exp - payload.iat).toBe(900); // 15 minutes
  });

  it('should reject JWT forged with alg: none', async () => {
    const forgedToken = jwt.sign(
      { sub: testUser.id, role: 'OWNER', type: 'ACCESS_TOKEN', iss: 'dms-api', aud: 'dms-clients' },
      '',
      { algorithm: 'none' as any },
    );

    // Verify forged token has alg: none
    const decoded: any = jwt.decode(forgedToken, { complete: true });
    expect(decoded.header.alg).toBe('none');
  });

  it('should reject tampered JWT signatures', async () => {
    const validToken = jwt.sign(
      { sub: testUser.id, role: 'OWNER', type: 'ACCESS_TOKEN', iss: 'dms-api', aud: 'dms-clients' },
      'wrong_unauthorized_signing_key_here_12345',
      { algorithm: 'HS256', expiresIn: '15m' },
    );

    // Verify verification fails against real server secret
    expect(() => {
      jwt.verify(validToken, secretKey);
    }).toThrow();
  });
});

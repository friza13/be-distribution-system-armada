import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Session Lifecycle, Refresh Rotation & Reuse Detection (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testUser: any;

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
        username: `session_rot_${Date.now()}`,
        phone: `+62820${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('PassRot123!'),
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

  it('should rotate refresh token and invalidate the old refresh token', async () => {
    // 1. Initial Login
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        username: testUser.username,
        password: 'PassRot123!',
        clientType: 'MOBILE',
      })
      .expect(HttpStatus.CREATED);

    const initialRefreshToken = loginRes.body.data.refreshToken;

    // 2. Perform Refresh (Single-use Rotation)
    const refreshRes = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: initialRefreshToken })
      .expect(HttpStatus.CREATED);

    expect(refreshRes.body.success).toBe(true);
    const newRefreshToken = refreshRes.body.data.refreshToken;
    expect(newRefreshToken).toBeDefined();
    expect(newRefreshToken).not.toBe(initialRefreshToken);

    // 3. Attempting to use old initialRefreshToken should trigger TOKEN_REUSE_DETECTED
    const reuseRes = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: initialRefreshToken })
      .expect(HttpStatus.UNAUTHORIZED);

    expect(reuseRes.body.success).toBe(false);
    expect(reuseRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    // 4. Verify that newRefreshToken is ALSO invalidated because entire token family was revoked!
    const subsequentRefresh = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: newRefreshToken })
      .expect(HttpStatus.UNAUTHORIZED);

    expect(subsequentRefresh.body.success).toBe(false);
  });
});

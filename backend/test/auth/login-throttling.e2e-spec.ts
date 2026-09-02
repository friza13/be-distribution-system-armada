import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RedisService } from '../../src/common/redis/redis.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Login Throttling & Audit Logging (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userTarget: any;
  let userOther: any;

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
    const redis = app.get(RedisService);
    if (redis && redis.resetRateLimit) {
      await redis.resetRateLimit('throttle:login:ip:127.0.0.1');
      await redis.resetRateLimit('throttle:login:ip:::ffff:127.0.0.1');
      await redis.resetRateLimit('throttle:login:ip:::1');
    }

    const ownerRole = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    userTarget = await prisma.user.create({
      data: {
        username: `target_${Date.now()}`,
        phone: `+62829${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('CorrectPass123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });

    userOther = await prisma.user.create({
      data: {
        username: `other_${Date.now()}`,
        phone: `+62830${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('CorrectPass123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    if (userTarget) {
      await prisma.session.deleteMany({ where: { userId: userTarget.id } });
      await prisma.device.deleteMany({ where: { userId: userTarget.id } });
      await prisma.user.delete({ where: { id: userTarget.id } });
    }
    if (userOther) {
      await prisma.session.deleteMany({ where: { userId: userOther.id } });
      await prisma.device.deleteMany({ where: { userId: userOther.id } });
      await prisma.user.delete({ where: { id: userOther.id } });
    }
    await app.close();
  });

  it('should throttle after 5 failed login attempts for a specific account without locking out others on the same IP', async () => {
    // 1. Five failed login attempts for userTarget
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ username: userTarget.username, password: 'WrongPassword!' });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    }

    // 2. Sixth attempt for userTarget must be REJECTED with 429 Too Many Requests
    const throttledRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: userTarget.username, password: 'CorrectPass123!' });

    expect(throttledRes.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(throttledRes.body.error.code).toBe('LOGIN_RATE_LIMITED');

    // 3. userOther on the SAME IP must still be able to log in successfully (NO blanket lockout)
    const otherRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: userOther.username, password: 'CorrectPass123!' });

    expect(otherRes.status).toBe(HttpStatus.CREATED);
    expect(otherRes.body.success).toBe(true);
  });

  it('should verify audit logs contain zero plaintext passwords or secrets', async () => {
    const logs = await prisma.auditLog.findMany({
      where: {
        action: { in: ['LOGIN_SUCCESS', 'LOGIN_FAILURE'] },
      },
      take: 10,
    });

    expect(logs.length).toBeGreaterThan(0);
    logs.forEach((log) => {
      const logString = JSON.stringify(log);
      expect(logString).not.toContain('CorrectPass123!');
      expect(logString).not.toContain('WrongPassword!');
    });
  });
});

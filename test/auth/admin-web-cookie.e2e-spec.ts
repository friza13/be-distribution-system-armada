import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Admin Web Cookie Transport & CSRF Defense (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testAdmin: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    prisma = app.get(PrismaService);

    const role = await prisma.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', name: 'Administrator' },
    });

    testAdmin = await prisma.user.create({
      data: {
        username: `admin_cookie_${Date.now()}`,
        phone: `+62819${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('AdminPass123!'),
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    if (testAdmin) {
      await prisma.session.deleteMany({ where: { userId: testAdmin.id } });
      await prisma.device.deleteMany({ where: { userId: testAdmin.id } });
      await prisma.user.delete({ where: { id: testAdmin.id } });
    }
    await app.close();
  });

  it('should issue HttpOnly Secure SameSite=Strict refresh cookie on Web Login', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        username: testAdmin.username,
        password: 'AdminPass123!',
        clientType: 'WEB',
      })
      .expect(HttpStatus.CREATED);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).not.toHaveProperty('refreshToken'); // Web does NOT return raw refreshToken in body

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const refreshCookie = (cookies as unknown as string[]).find((c: string) => c.includes('dms_refresh_token'));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('SameSite=Strict');
    expect(refreshCookie).toContain('Path=/v1/auth');
  });

  it('should enforce Double Submit CSRF Token and Origin check on Web Refresh', async () => {
    // 1. Fetch CSRF token
    const csrfRes = await request(app.getHttpServer())
      .get('/v1/auth/csrf')
      .expect(HttpStatus.OK);

    const csrfToken = csrfRes.body.data.csrfToken;
    const csrfCookie = (csrfRes.headers['set-cookie'] as unknown as string[]).find((c: string) =>
      c.includes('dms_csrf_token'),
    );

    // 2. Perform Web Login to get refresh cookie
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        username: testAdmin.username,
        password: 'AdminPass123!',
        clientType: 'WEB',
      })
      .expect(HttpStatus.CREATED);

    const refreshCookie = (loginRes.headers['set-cookie'] as unknown as string[]).find((c: string) =>
      c.includes('dms_refresh_token'),
    );

    // 3. Positive Test: Valid Refresh with CSRF header, matching cookie, and valid Origin
    const validRefresh = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', csrfToken)
      .set('x-client-type', 'WEB')
      .set('Cookie', [`${refreshCookie}; ${csrfCookie}`])
      .expect(HttpStatus.CREATED);

    expect(validRefresh.body.success).toBe(true);
    expect(validRefresh.body.data).toHaveProperty('accessToken');

    // 4. Negative Test: Missing x-csrf-token header should be rejected 403 Forbidden
    const invalidCsrf = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('x-client-type', 'WEB')
      .set('Cookie', [`${refreshCookie}; ${csrfCookie}`])
      .expect(HttpStatus.FORBIDDEN);

    expect(invalidCsrf.body.success).toBe(false);
    expect(invalidCsrf.body.error.message).toContain('CSRF_TOKEN_MISMATCH');

    // 5. Negative Test: Untrusted Origin should be rejected 403 Forbidden
    const untrustedOrigin = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', 'https://attacker-malicious-website.com')
      .set('x-csrf-token', csrfToken)
      .set('x-client-type', 'WEB')
      .set('Cookie', [`${refreshCookie}; ${csrfCookie}`])
      .expect(HttpStatus.FORBIDDEN);

    expect(untrustedOrigin.body.success).toBe(false);
    expect(untrustedOrigin.body.error.message).toContain('CSRF_ORIGIN_DENIED');
  });
});

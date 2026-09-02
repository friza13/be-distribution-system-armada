import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Account Lifecycle & Instant Revocation (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminUser: any;
  let testUser: any;
  let adminToken: string;

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

    const adminRole = await prisma.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', name: 'Administrator' },
    });

    const driverRole = await prisma.role.upsert({
      where: { code: 'DRIVER' },
      update: {},
      create: { code: 'DRIVER', name: 'Driver' },
    });

    const permManage = await prisma.permission.upsert({
      where: { code: 'user:manage' },
      update: {},
      create: { code: 'user:manage', description: 'Manage users' },
    });

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permManage.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permManage.id,
      },
    });

    adminUser = await prisma.user.create({
      data: {
        username: `admin_life_${Date.now()}`,
        phone: `+62825${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('AdminPass123!'),
        roleId: adminRole.id,
        status: 'ACTIVE',
      },
    });

    testUser = await prisma.user.create({
      data: {
        username: `user_life_${Date.now()}`,
        phone: `+62826${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('UserPass123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: adminUser.username, password: 'AdminPass123!' });
    adminToken = adminLogin.body.data.accessToken;
  });

  afterAll(async () => {
    if (testUser) {
      await prisma.session.deleteMany({ where: { userId: testUser.id } });
      await prisma.device.deleteMany({ where: { userId: testUser.id } });
      await prisma.user.delete({ where: { id: testUser.id } });
    }
    if (adminUser) {
      await prisma.session.deleteMany({ where: { userId: adminUser.id } });
      await prisma.device.deleteMany({ where: { userId: adminUser.id } });
      await prisma.user.delete({ where: { id: adminUser.id } });
    }
    await app.close();
  });

  it('should reject login if account status is SUSPENDED or DISABLED', async () => {
    // 1. Suspend User
    await prisma.user.update({
      where: { id: testUser.id },
      data: { status: 'SUSPENDED' },
    });

    const suspendRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: testUser.username, password: 'UserPass123!' })
      .expect(HttpStatus.UNAUTHORIZED);

    expect(suspendRes.body.error.code).toBe('ACCOUNT_SUSPENDED');

    // 2. Disable User
    await prisma.user.update({
      where: { id: testUser.id },
      data: { status: 'DISABLED' },
    });

    const disableRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: testUser.username, password: 'UserPass123!' })
      .expect(HttpStatus.UNAUTHORIZED);

    expect(disableRes.body.error.code).toBe('ACCOUNT_DISABLED');

    // Re-activate for next test
    await prisma.user.update({
      where: { id: testUser.id },
      data: { status: 'ACTIVE' },
    });
  });

  it('should reject existing access token when user role is modified by Admin', async () => {
    // 1. Login to obtain access token with role DRIVER
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: testUser.username, password: 'UserPass123!' })
      .expect(HttpStatus.CREATED);

    const oldToken = loginRes.body.data.accessToken;

    // 2. Verify old token works
    const profileRes = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(HttpStatus.OK);
    expect(profileRes.body.success).toBe(true);

    // 3. Admin updates user role to OWNER
    const ownerRole = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    await request(app.getHttpServer())
      .patch(`/v1/users/${testUser.id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleCode: 'OWNER' })
      .expect(HttpStatus.OK);

    // 4. Request with oldToken must now be REJECTED with ROLE_UPDATED_REAUTH_REQUIRED
    const rejectedRes = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(HttpStatus.UNAUTHORIZED);

    expect(rejectedRes.body.success).toBe(false);
    expect(rejectedRes.body.error.code).toBe('ROLE_UPDATED_REAUTH_REQUIRED');
  });
});

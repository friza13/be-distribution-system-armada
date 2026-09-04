import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('RBAC, Permissions Guard & Object-Level IDOR Defense (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminUser: any;
  let driverA: any;
  let driverB: any;
  let driverRecordA: any;
  let driverRecordB: any;
  let deliveryB: any;
  let adminToken: string;
  let driverTokenA: string;

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

    // Setup Roles & Permissions
    const permManage = await prisma.permission.upsert({
      where: { code: 'user:manage' },
      update: {},
      create: { code: 'user:manage', description: 'Manage users' },
    });

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

    // Create Admin User
    adminUser = await prisma.user.create({
      data: {
        username: `admin_rbac_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('AdminPass123!'),
        roleId: adminRole.id,
        status: 'ACTIVE',
      },
    });

    // Create Driver A
    driverA = await prisma.user.create({
      data: {
        username: `drva_${Date.now()}`,
        phone: `+62823${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('DriverPass123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverRecordA = await prisma.driver.create({
      data: {
        userId: driverA.id,
        employeeCode: `EMP-A-${Date.now().toString().slice(-4)}`,
        displayName: 'Driver A',
        phone: driverA.phone,
      },
    });

    // Create Driver B
    driverB = await prisma.user.create({
      data: {
        username: `drvb_${Date.now()}`,
        phone: `+62824${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('DriverPass123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    driverRecordB = await prisma.driver.create({
      data: {
        userId: driverB.id,
        employeeCode: `EMP-B-${Date.now().toString().slice(-4)}`,
        displayName: 'Driver B',
        phone: driverB.phone,
      },
    });

    // Create Delivery assigned to Driver B
    deliveryB = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-B-${Date.now()}`,
        driverId: driverRecordB.id,
        status: 'ASSIGNED',
        createdBy: adminUser.id,
      },
    });

    // Logins
    const adminLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: adminUser.username, password: 'AdminPass123!' });
    adminToken = adminLogin.body.data.accessToken;

    const driverLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ username: driverA.username, password: 'DriverPass123!' });
    driverTokenA = driverLogin.body.data.accessToken;
  });

  afterAll(async () => {
    if (deliveryB) {
      await prisma.delivery.delete({ where: { id: deliveryB.id } });
    }
    if (driverA) {
      await prisma.session.deleteMany({ where: { userId: driverA.id } });
      await prisma.device.deleteMany({ where: { userId: driverA.id } });
      if (driverRecordA) await prisma.driver.delete({ where: { id: driverRecordA.id } });
      await prisma.user.delete({ where: { id: driverA.id } });
    }
    if (driverB) {
      await prisma.session.deleteMany({ where: { userId: driverB.id } });
      await prisma.device.deleteMany({ where: { userId: driverB.id } });
      if (driverRecordB) await prisma.driver.delete({ where: { id: driverRecordB.id } });
      await prisma.user.delete({ where: { id: driverB.id } });
    }
    if (adminUser) {
      await prisma.session.deleteMany({ where: { userId: adminUser.id } });
      await prisma.device.deleteMany({ where: { userId: adminUser.id } });
      await prisma.user.delete({ where: { id: adminUser.id } });
    }
    await app.close();
  });

  it('should allow Admin to access role/permission protected user route', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/users/${driverA.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
  });

  it('should reject Driver trying to access Admin role route with 403 Forbidden', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/users/${driverA.id}/status`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .send({ status: 'ACTIVE' })
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('should reject Driver A attempting to view Driver B delivery (IDOR / BOLA defense)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/deliveries/${deliveryB.id}`)
      .set('Authorization', `Bearer ${driverTokenA}`)
      .expect(HttpStatus.FORBIDDEN);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('should allow Admin to view Driver B delivery', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/deliveries/${deliveryB.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(deliveryB.id);
  });
});

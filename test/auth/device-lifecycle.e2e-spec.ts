import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Device Lifecycle & Single Active Driver Concurrency (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let driverUser: any;
  let driverRecord: any;

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

    const driverRole = await prisma.role.upsert({
      where: { code: 'DRIVER' },
      update: {},
      create: { code: 'DRIVER', name: 'Driver' },
    });

    driverUser = await prisma.user.create({
      data: {
        username: `drv_conc_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('DriverPass123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });

    driverRecord = await prisma.driver.create({
      data: {
        userId: driverUser.id,
        employeeCode: `EMP-DRV-${Date.now().toString().slice(-4)}`,
        displayName: 'Test Concurrent Driver',
        phone: driverUser.phone,
      },
    });
  });

  afterAll(async () => {
    if (driverUser) {
      await prisma.session.deleteMany({ where: { userId: driverUser.id } });
      await prisma.device.deleteMany({ where: { userId: driverUser.id } });
      if (driverRecord) {
        await prisma.driver.delete({ where: { id: driverRecord.id } });
      }
      await prisma.user.delete({ where: { id: driverUser.id } });
    }
    await app.close();
  });

  it('should register and retrieve user devices', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        username: driverUser.username,
        password: 'DriverPass123!',
      })
      .expect(HttpStatus.CREATED);

    const token = loginRes.body.data.accessToken;

    const deviceRes = await request(app.getHttpServer())
      .post('/v1/devices/register')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceIdentifier: 'android-pixel-7-uuid-1234',
        platform: 'ANDROID',
        appVersion: '1.2.0',
        pushToken: 'fcm_push_token_xyz',
      })
      .expect(HttpStatus.CREATED);

    expect(deviceRes.body.success).toBe(true);
    expect(deviceRes.body.data.deviceIdentifier).toBe('android-pixel-7-uuid-1234');
  });

  it('should enforce Single Active Driver Session under concurrent logins via SELECT FOR UPDATE', async () => {
    // Launch 2 parallel login requests for the same Driver
    const loginPromises = [
      request(app.getHttpServer()).post('/v1/auth/login').send({
        username: driverUser.username,
        password: 'DriverPass123!',
      }),
      request(app.getHttpServer()).post('/v1/auth/login').send({
        username: driverUser.username,
        password: 'DriverPass123!',
      }),
    ];

    const results = await Promise.all(loginPromises);
    expect(results[0].status).toBe(HttpStatus.CREATED);
    expect(results[1].status).toBe(HttpStatus.CREATED);

    // Query active sessions from PostgreSQL for this driver
    const activeSessions = await prisma.session.findMany({
      where: {
        userId: driverUser.id,
        isRevoked: false,
      },
    });

    // Exactly 1 active session must exist!
    expect(activeSessions.length).toBe(1);
  });
});

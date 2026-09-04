import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { hashPassword } from '../../src/common/utils/password.util';

describe('Emergencies (SOS) Subsystem (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerUser: any;
  let ownerToken: string;

  let driverUser: any;
  let driverEntity: any;
  let driverToken: string;

  const secretKey = 'test_secret_with_minimum_32_characters_length_here';
  const issuer = 'dms-api';
  const audience = 'dms-clients';

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

    const ownerRole = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });
    const driverRole = await prisma.role.upsert({
      where: { code: 'DRIVER' },
      update: {},
      create: { code: 'DRIVER', name: 'Driver' },
    });

    ownerUser = await prisma.user.create({
      data: {
        username: `emg_own_${Date.now()}`,
        phone: `+62818${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        status: 'ACTIVE',
      },
    });
    const devOwn = await prisma.device.create({
      data: { userId: ownerUser.id, deviceIdentifier: `dev-own-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const sesOwn = await prisma.session.create({
      data: { userId: ownerUser.id, deviceId: devOwn.id, refreshTokenHash: 'h_own', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    ownerToken = jwt.sign(
      { sub: ownerUser.id, role: 'OWNER', deviceId: devOwn.id, sessionId: sesOwn.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    driverUser = await prisma.user.create({
      data: {
        username: `emg_drv_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        status: 'ACTIVE',
      },
    });
    const devDrv = await prisma.device.create({
      data: { userId: driverUser.id, deviceIdentifier: `dev-drv-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const sesDrv = await prisma.session.create({
      data: { userId: driverUser.id, deviceId: devDrv.id, refreshTokenHash: 'h_drv', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    driverEntity = await prisma.driver.create({
      data: {
        userId: driverUser.id,
        employeeCode: `EMP-EMG-${Date.now()}`,
        displayName: 'SOS Driver',
        phone: driverUser.phone,
        operationalStatus: 'AVAILABLE',
      },
    });
    driverToken = jwt.sign(
      { sub: driverUser.id, role: 'DRIVER', deviceId: devDrv.id, sessionId: sesDrv.id, driverId: driverEntity.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );
  });

  afterAll(async () => {
    if (driverUser) {
      await prisma.emergency.deleteMany({ where: { driverId: driverEntity.id } });
      await prisma.driver.deleteMany({ where: { userId: driverUser.id } });
      await prisma.user.delete({ where: { id: driverUser.id } });
    }
    if (ownerUser) {
      await prisma.session.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.device.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.user.delete({ where: { id: ownerUser.id } });
    }
    await app.close();
  });

  it('should trigger, list, acknowledge, and resolve SOS emergency lifecycle', async () => {
    // 1. Driver triggers SOS
    const triggerRes = await request(app.getHttpServer())
      .post('/v1/me/emergencies')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        latitude: -6.2001,
        longitude: 106.8162,
        emergencyType: 'ACCIDENT',
        note: 'Vehicle broke down on highway',
      })
      .expect(HttpStatus.CREATED);

    const emergencyId = triggerRes.body.data.id;
    expect(emergencyId).toBeDefined();
    expect(triggerRes.body.data.status).toBe('TRIGGERED');

    // Verify driver status updated to EMERGENCY
    const updatedDriver = await prisma.driver.findUnique({ where: { id: driverEntity.id } });
    expect(updatedDriver?.operationalStatus).toBe('EMERGENCY');

    // 2. Owner lists emergencies
    const listRes = await request(app.getHttpServer())
      .get('/v1/emergencies')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(HttpStatus.OK);

    const emergencyList = listRes.body.data.emergencies;
    expect(emergencyList.some((e: any) => e.id === emergencyId)).toBe(true);

    // 3. Dispatcher/Owner updates status to ACKNOWLEDGED
    const ackRes = await request(app.getHttpServer())
      .patch(`/v1/emergencies/${emergencyId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'ACKNOWLEDGED' })
      .expect(HttpStatus.OK);

    expect(ackRes.body.data.status).toBe('ACKNOWLEDGED');

    // 4. Dispatcher/Owner updates status to RESOLVED
    const resRes = await request(app.getHttpServer())
      .patch(`/v1/emergencies/${emergencyId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'RESOLVED' })
      .expect(HttpStatus.OK);

    expect(resRes.body.data.status).toBe('RESOLVED');

    // Driver operational status reverted to AVAILABLE
    const resolvedDriver = await prisma.driver.findUnique({ where: { id: driverEntity.id } });
    expect(resolvedDriver?.operationalStatus).toBe('AVAILABLE');
  });
});

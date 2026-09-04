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

describe('Fleet & Delivery Tenant Isolation (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let orgA: any;
  let orgB: any;

  let ownerUserA: any;
  let ownerTokenA: string;

  let ownerUserB: any;
  let ownerTokenB: string;

  let driverUserA: any;
  let driverEntityA: any;

  let driverUserB: any;
  let driverEntityB: any;

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

    // 1. Create two isolated organizations
    orgA = await prisma.organization.create({
      data: { code: `ORG-A-${Date.now()}`, name: 'Company Alpha' },
    });
    orgB = await prisma.organization.create({
      data: { code: `ORG-B-${Date.now()}`, name: 'Company Beta' },
    });

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

    // Owner A
    ownerUserA = await prisma.user.create({
      data: {
        username: `own_a_${Date.now()}`,
        phone: `+62818${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        organizationId: orgA.id,
        status: 'ACTIVE',
      },
    });
    const devA = await prisma.device.create({
      data: { userId: ownerUserA.id, deviceIdentifier: `dev-a-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const sesA = await prisma.session.create({
      data: { userId: ownerUserA.id, deviceId: devA.id, refreshTokenHash: 'h_a', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    ownerTokenA = jwt.sign(
      { sub: ownerUserA.id, role: 'OWNER', deviceId: devA.id, sessionId: sesA.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // Owner B
    ownerUserB = await prisma.user.create({
      data: {
        username: `own_b_${Date.now()}`,
        phone: `+62819${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: ownerRole.id,
        organizationId: orgB.id,
        status: 'ACTIVE',
      },
    });
    const devB = await prisma.device.create({
      data: { userId: ownerUserB.id, deviceIdentifier: `dev-b-${Date.now()}`, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const sesB = await prisma.session.create({
      data: { userId: ownerUserB.id, deviceId: devB.id, refreshTokenHash: 'h_b', tokenFamily: uuidv4(), expiresAt: new Date(Date.now() + 86400000) },
    });
    ownerTokenB = jwt.sign(
      { sub: ownerUserB.id, role: 'OWNER', deviceId: devB.id, sessionId: sesB.id, type: 'ACCESS_TOKEN' },
      secretKey,
      { algorithm: 'HS256', expiresIn: '15m', issuer, audience, header: { alg: 'HS256', typ: 'JWT', kid: 'dms-2026-q3' } },
    );

    // Driver A in Org A
    driverUserA = await prisma.user.create({
      data: {
        username: `drva_${Date.now()}`,
        phone: `+62821${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        organizationId: orgA.id,
        status: 'ACTIVE',
      },
    });
    driverEntityA = await prisma.driver.create({
      data: {
        userId: driverUserA.id,
        organizationId: orgA.id,
        employeeCode: `EMP-A-${Date.now()}`,
        displayName: 'Alpha Driver',
        phone: driverUserA.phone,
        operationalStatus: 'AVAILABLE',
      },
    });

    // Driver B in Org B
    driverUserB = await prisma.user.create({
      data: {
        username: `drvb_${Date.now()}`,
        phone: `+62822${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword('Password123!'),
        roleId: driverRole.id,
        organizationId: orgB.id,
        status: 'ACTIVE',
      },
    });
    driverEntityB = await prisma.driver.create({
      data: {
        userId: driverUserB.id,
        organizationId: orgB.id,
        employeeCode: `EMP-B-${Date.now()}`,
        displayName: 'Beta Driver',
        phone: driverUserB.phone,
        operationalStatus: 'AVAILABLE',
      },
    });
  });

  afterAll(async () => {
    if (driverUserA) {
      await prisma.driver.deleteMany({ where: { userId: driverUserA.id } });
      await prisma.user.delete({ where: { id: driverUserA.id } });
    }
    if (driverUserB) {
      await prisma.driver.deleteMany({ where: { userId: driverUserB.id } });
      await prisma.user.delete({ where: { id: driverUserB.id } });
    }
    if (ownerUserA) {
      await prisma.session.deleteMany({ where: { userId: ownerUserA.id } });
      await prisma.device.deleteMany({ where: { userId: ownerUserA.id } });
      await prisma.user.delete({ where: { id: ownerUserA.id } });
    }
    if (ownerUserB) {
      await prisma.session.deleteMany({ where: { userId: ownerUserB.id } });
      await prisma.device.deleteMany({ where: { userId: ownerUserB.id } });
      await prisma.user.delete({ where: { id: ownerUserB.id } });
    }
    if (orgA) await prisma.organization.delete({ where: { id: orgA.id } });
    if (orgB) await prisma.organization.delete({ where: { id: orgB.id } });
    await app.close();
  });

  it('should isolate active driver locations between organizations for GET /v1/fleet/locations', async () => {
    // Owner A views locations -> should only see Driver A
    const resA = await request(app.getHttpServer())
      .get('/v1/fleet/locations')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(HttpStatus.OK);

    const driverIdsA = resA.body.data.drivers.map((d: any) => d.driverId);
    expect(driverIdsA).toContain(driverEntityA.id);
    expect(driverIdsA).not.toContain(driverEntityB.id);

    // Owner B views locations -> should only see Driver B
    const resB = await request(app.getHttpServer())
      .get('/v1/fleet/locations')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .expect(HttpStatus.OK);

    const driverIdsB = resB.body.data.drivers.map((d: any) => d.driverId);
    expect(driverIdsB).toContain(driverEntityB.id);
    expect(driverIdsB).not.toContain(driverEntityA.id);
  });
});

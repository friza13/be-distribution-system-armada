import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

describe('Database Remediation Schema (E2E)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should support Organization and OutboxEvent models with foreign keys', async () => {
    // 1. Create Organization
    const org = await (prisma as any).organization.create({
      data: {
        code: `ORG-${Date.now()}`,
        name: 'Test Logistics Org',
        status: 'ACTIVE',
      },
    });
    expect(org.id).toBeDefined();

    // 2. Create User linked to Organization
    const role = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    const user = await (prisma as any).user.create({
      data: {
        username: `org_usr_${Date.now()}`,
        phone: `+62819${Date.now().toString().slice(-8)}`,
        passwordHash: 'hash',
        roleId: role.id,
        organizationId: org.id,
      },
    });
    expect(user.organizationId).toBe(org.id);

    // 3. Create OutboxEvent
    const outbox = await (prisma as any).outboxEvent.create({
      data: {
        topic: 'delivery.status.changed',
        payload: { deliveryId: uuidv4(), status: 'ASSIGNED' },
        status: 'PENDING',
      },
    });
    expect(outbox.id).toBeDefined();
    expect(outbox.status).toBe('PENDING');

    // Cleanup
    await (prisma as any).outboxEvent.delete({ where: { id: outbox.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await (prisma as any).organization.delete({ where: { id: org.id } });
  });
});

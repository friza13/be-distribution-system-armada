import { PrismaClient } from '@prisma/client';

describe('Relational Schema & Foreign Key Integrity (E2E)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should enforce ON DELETE RESTRICT when attempting to delete a user who created active deliveries', async () => {
    // 1. Create a Role
    const role = await prisma.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', name: 'Administrator' },
    });

    // 2. Create User
    const user = await prisma.user.create({
      data: {
        username: `admin_test_${Date.now()}`,
        email: `admin_${Date.now()}@test.com`,
        phone: `+62812${Date.now().toString().slice(-8)}`,
        passwordHash: 'hashed_password_123',
        roleId: role.id,
      },
    });

    // 3. Create Delivery created by this User
    const delivery = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-${Date.now()}`,
        createdBy: user.id,
      },
    });

    // 4. Expect deleting the user to FAIL due to foreign key RESTRICT
    await expect(
      prisma.user.delete({
        where: { id: user.id },
      }),
    ).rejects.toThrow();

    // Cleanup delivery first, then user
    await prisma.delivery.delete({ where: { id: delivery.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
